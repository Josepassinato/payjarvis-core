/**
 * Address Routes — /api/addresses
 *
 * CRUD for structured US/BR shipping & billing addresses.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";

// ─── Validation helpers ─────────────────────────────────

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP",
]);

const BR_STATE_CODES = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

function validateZip(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(zip);
}

function validateCep(cep: string): boolean {
  return /^\d{8}$/.test(cep.replace("-", ""));
}

function validateCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  // Checksum validation
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (parseInt(digits[9]) !== check) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return parseInt(digits[10]) === check;
}

function normalizePostalCode(code: string, country: "US" | "BR"): string {
  if (country === "BR") return code.replace(/\D/g, "");
  return code.trim();
}

interface AddressBody {
  label?: string;
  type?: "SHIPPING" | "BILLING" | "BOTH";
  country: "US" | "BR";
  isDefault?: boolean;
  fullName: string;
  phone?: string;
  street: string;
  complement?: string;
  city: string;
  state: string;
  postalCode: string;
  neighborhood?: string;
  cpf?: string;
}

function validateAddress(body: AddressBody): string | null {
  if (!body.country || !["US", "BR"].includes(body.country)) {
    return "country must be US or BR";
  }
  if (!body.fullName || body.fullName.length < 2) return "fullName is required";
  if (!body.street || body.street.length < 3) return "street is required";
  if (!body.city || body.city.length < 2) return "city is required";
  if (!body.state) return "state is required";
  if (!body.postalCode) return "postalCode is required";

  const stateUpper = body.state.toUpperCase();
  if (body.country === "US") {
    if (!US_STATE_CODES.has(stateUpper)) return `Invalid US state: ${body.state}`;
    if (!validateZip(body.postalCode)) return "Invalid ZIP code (expected 12345 or 12345-6789)";
  } else {
    if (!BR_STATE_CODES.has(stateUpper)) return `Invalid BR state: ${body.state}`;
    if (!validateCep(body.postalCode)) return "Invalid CEP (expected 8 digits)";
    if (!body.neighborhood) return "neighborhood (bairro) is required for BR addresses";
    if (body.cpf && !validateCpf(body.cpf)) return "Invalid CPF";
  }

  return null;
}

// ─── Routes ─────────────────────────────────────────────

export default async function addressRoutes(app: FastifyInstance) {
  // List user addresses
  app.get("/api/addresses", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const addresses = await prisma.userAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return { success: true, data: addresses };
  });

  // Get single address
  app.get("/api/addresses/:id", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const address = await prisma.userAddress.findFirst({
      where: { id, userId: user.id },
    });
    if (!address) return reply.status(404).send({ success: false, error: "Address not found" });

    return { success: true, data: address };
  });

  // Create address
  app.post("/api/addresses", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const body = request.body as AddressBody;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const error = validateAddress(body);
    if (error) return reply.status(400).send({ success: false, error });

    const postalCode = normalizePostalCode(body.postalCode, body.country);

    // If setting as default, unset other defaults of same type
    if (body.isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    // If first address, make it default
    const existingCount = await prisma.userAddress.count({ where: { userId: user.id } });

    const address = await prisma.userAddress.create({
      data: {
        userId: user.id,
        label: body.label,
        type: body.type || "SHIPPING",
        country: body.country,
        isDefault: body.isDefault || existingCount === 0,
        fullName: body.fullName,
        phone: body.phone,
        street: body.street,
        complement: body.complement,
        city: body.city,
        state: body.state.toUpperCase(),
        postalCode,
        neighborhood: body.neighborhood,
        cpf: body.cpf ? body.cpf.replace(/\D/g, "") : undefined,
      },
    });

    // Also update legacy shippingAddress field for backward compatibility
    if (address.isDefault && (address.type === "SHIPPING" || address.type === "BOTH")) {
      const legacy = `${body.street}${body.complement ? ", " + body.complement : ""}, ${body.city}, ${body.state.toUpperCase()} ${postalCode}`;
      await prisma.user.update({
        where: { id: user.id },
        data: { shippingAddress: legacy },
      });
    }

    return reply.status(201).send({ success: true, data: address });
  });

  // Update address
  app.put("/api/addresses/:id", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const { id } = request.params as { id: string };
    const body = request.body as Partial<AddressBody>;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const existing = await prisma.userAddress.findFirst({ where: { id, userId: user.id } });
    if (!existing) return reply.status(404).send({ success: false, error: "Address not found" });

    // Merge with existing for validation
    const merged: AddressBody = {
      country: (body.country || existing.country) as "US" | "BR",
      fullName: body.fullName || existing.fullName,
      street: body.street || existing.street,
      city: body.city || existing.city,
      state: body.state || existing.state,
      postalCode: body.postalCode || existing.postalCode,
      neighborhood: body.neighborhood ?? existing.neighborhood ?? undefined,
      cpf: body.cpf ?? existing.cpf ?? undefined,
      complement: body.complement ?? existing.complement ?? undefined,
    };

    const error = validateAddress(merged);
    if (error) return reply.status(400).send({ success: false, error });

    if (body.isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const postalCode = body.postalCode
      ? normalizePostalCode(body.postalCode, merged.country)
      : undefined;

    const address = await prisma.userAddress.update({
      where: { id },
      data: {
        label: body.label,
        type: body.type,
        country: body.country,
        isDefault: body.isDefault,
        fullName: body.fullName,
        phone: body.phone,
        street: body.street,
        complement: body.complement,
        city: body.city,
        state: body.state?.toUpperCase(),
        postalCode,
        neighborhood: body.neighborhood,
        cpf: body.cpf ? body.cpf.replace(/\D/g, "") : undefined,
      },
    });

    return { success: true, data: address };
  });

  // Delete address
  app.delete("/api/addresses/:id", { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const existing = await prisma.userAddress.findFirst({ where: { id, userId: user.id } });
    if (!existing) return reply.status(404).send({ success: false, error: "Address not found" });

    await prisma.userAddress.delete({ where: { id } });

    // If deleted the default, promote next one
    if (existing.isDefault) {
      const next = await prisma.userAddress.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (next) {
        await prisma.userAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    return { success: true };
  });

  // ─── KYC Profile Update ─────────────────────────────────

  app.put("/api/kyc/profile", { preHandler: requireAuth }, async (request, reply) => {
    const clerkId = (request as any).userId;
    const body = request.body as {
      fullName?: string;
      dateOfBirth?: string;
      documentNumber?: string;
      country?: string;
    };

    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const updates: Record<string, any> = {};

    if (body.fullName && body.fullName.length >= 2) updates.fullName = body.fullName;
    if (body.dateOfBirth) {
      const dob = new Date(body.dateOfBirth);
      if (isNaN(dob.getTime())) return reply.status(400).send({ success: false, error: "Invalid dateOfBirth" });
      // Must be at least 18
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) return reply.status(400).send({ success: false, error: "Must be at least 18 years old" });
      updates.dateOfBirth = dob;
    }
    if (body.country && /^[A-Z]{2}$/.test(body.country.toUpperCase())) {
      updates.country = body.country.toUpperCase();
    }
    if (body.documentNumber) {
      // If country is BR, validate CPF
      const country = body.country?.toUpperCase() || user.country;
      if (country === "BR" && !validateCpf(body.documentNumber)) {
        return reply.status(400).send({ success: false, error: "Invalid CPF" });
      }
      updates.documentNumber = body.documentNumber.replace(/\D/g, "");
    }

    // Auto-upgrade KYC level to BASIC if enough data provided
    if (Object.keys(updates).length > 0) {
      const hasName = updates.fullName || user.fullName !== "PayJarvis User";
      const hasDob = updates.dateOfBirth || user.dateOfBirth;
      const hasCountry = updates.country || user.country;
      if (hasName && hasDob && hasCountry && user.kycLevel === "NONE") {
        updates.kycLevel = "BASIC";
        updates.kycSubmittedAt = new Date();
        updates.status = "ACTIVE";
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ success: false, error: "No valid fields to update" });
    }

    const updated = await prisma.user.update({
      where: { clerkId },
      data: updates,
      select: {
        fullName: true,
        dateOfBirth: true,
        documentNumber: true,
        country: true,
        kycLevel: true,
        status: true,
      },
    });

    return { success: true, data: updated };
  });

  // Get KYC profile
  app.get("/api/kyc/profile", { preHandler: requireAuth }, async (request, reply) => {
    const clerkId = (request as any).userId;
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: {
        fullName: true,
        dateOfBirth: true,
        documentNumber: true,
        country: true,
        kycLevel: true,
        status: true,
        kycSubmittedAt: true,
      },
    });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    return { success: true, data: user };
  });
}
