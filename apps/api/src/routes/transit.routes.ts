/**
 * Transit Routes — Ground transportation API
 *
 * POST /api/transit/search       — Search train + bus options
 * POST /api/transit/compare      — Compare ground transit vs flight
 * GET  /api/transit/stations     — Search stations (Amtrak + bus)
 * GET  /api/transit/status/:train — Get Amtrak train status
 * POST /api/transit/book         — Book a trip
 */

import type { FastifyInstance } from "fastify";
import {
  searchAllTransit,
  compareTransitVsFlight,
  findStation,
  getTrainStatus,
  bookTrip,
} from "../services/transit/transit-service.js";

export async function transitRoutes(app: FastifyInstance) {
  // ── Search all transit options ────────────────────────
  app.post("/api/transit/search", async (request, reply) => {
    const body = request.body as {
      origin?: string;
      destination?: string;
      date?: string;
      passengers?: number;
      returnDate?: string;
    };

    if (!body?.origin || !body?.destination || !body?.date) {
      return reply
        .status(400)
        .send({ success: false, error: "origin, destination, and date are required" });
    }

    try {
      const outbound = await searchAllTransit(
        body.origin,
        body.destination,
        body.date,
        body.passengers
      );

      let returnTrips: Awaited<ReturnType<typeof searchAllTransit>> | undefined = undefined;
      if (body.returnDate) {
        returnTrips = await searchAllTransit(
          body.destination,
          body.origin,
          body.returnDate,
          body.passengers
        );
      }

      return reply.send({
        success: true,
        data: {
          outbound,
          ...(returnTrips ? { return: returnTrips } : {}),
          totalOptions: outbound.length + (returnTrips?.length ?? 0),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transit search failed";
      request.log.error(err, "[TRANSIT] search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Compare transit vs flight ─────────────────────────
  app.post("/api/transit/compare", async (request, reply) => {
    const body = request.body as {
      origin?: string;
      destination?: string;
      date?: string;
    };

    if (!body?.origin || !body?.destination || !body?.date) {
      return reply
        .status(400)
        .send({ success: false, error: "origin, destination, and date are required" });
    }

    try {
      const comparison = await compareTransitVsFlight(
        body.origin,
        body.destination,
        body.date
      );
      return reply.send({ success: true, data: comparison });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Comparison failed";
      request.log.error(err, "[TRANSIT] compare error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Search stations ───────────────────────────────────
  app.get("/api/transit/stations", async (request, reply) => {
    const { query, type } = request.query as {
      query?: string;
      type?: "amtrak" | "bus" | "all";
    };

    if (!query || query.trim().length < 2) {
      return reply
        .status(400)
        .send({ success: false, error: "query parameter is required (min 2 chars)" });
    }

    try {
      const stations = await findStation(query, type);
      return reply.send({ success: true, data: stations });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Station search failed";
      request.log.error(err, "[TRANSIT] stations error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Amtrak train status ──────────────────────────────
  app.get("/api/transit/status/:train", async (request, reply) => {
    const { train } = request.params as { train: string };
    const { date } = request.query as { date?: string };

    if (!train || train.trim().length === 0) {
      return reply
        .status(400)
        .send({ success: false, error: "Train number is required" });
    }

    try {
      const status = await getTrainStatus(train, date);

      if (!status) {
        return reply
          .status(404)
          .send({ success: false, error: `No status found for train ${train}` });
      }

      return reply.send({ success: true, data: status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status check failed";
      request.log.error(err, "[TRANSIT] status error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Book a trip ───────────────────────────────────────
  app.post("/api/transit/book", async (request, reply) => {
    const body = request.body as {
      type?: "train" | "bus";
      tripId?: string;
      passengerInfo?: {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
      };
    };

    if (!body?.type || !body?.tripId || !body?.passengerInfo) {
      return reply.status(400).send({
        success: false,
        error: "type, tripId, and passengerInfo are required",
      });
    }

    if (!body.passengerInfo.firstName || !body.passengerInfo.lastName || !body.passengerInfo.email) {
      return reply.status(400).send({
        success: false,
        error: "passengerInfo must include firstName, lastName, and email",
      });
    }

    try {
      const result = await bookTrip(body.type, body.tripId, body.passengerInfo);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Booking failed";
      request.log.error(err, "[TRANSIT] book error");
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
