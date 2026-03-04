import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import PDFDocument from "pdfkit";
import { requireAuth } from "../middleware/auth.js";

export async function transactionRoutes(app: FastifyInstance) {
  // List transactions with filters + pagination
  app.get("/transactions", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const { botId, dateFrom, dateTo, decision, category, page: pageStr, limit: limitStr } = request.query as {
      botId?: string;
      dateFrom?: string;
      dateTo?: string;
      decision?: string;
      category?: string;
      page?: string;
      limit?: string;
    };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, error: "User not found" };

    const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? "20", 10) || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { ownerId: user.id };
    if (botId) where.botId = botId;
    if (decision) where.decision = decision;
    if (category) {
      // Support multiple categories: ?category=food,travel
      const categories = category.split(",").map((c) => c.trim()).filter(Boolean);
      if (categories.length === 1) {
        where.category = categories[0];
      } else if (categories.length > 1) {
        where.category = { in: categories };
      }
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where: where as any }),
    ]);

    return {
      success: true,
      data: transactions,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  });

  // Export transactions as PDF
  app.get("/transactions/export/pdf", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId, dateFrom, dateTo } = request.query as {
      botId?: string;
      dateFrom?: string;
      dateTo?: string;
    };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const where: Record<string, unknown> = { ownerId: user.id };
    if (botId) where.botId = botId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
    }

    const transactions = await prisma.transaction.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
    });

    let botName = "Todos os bots";
    let trustScore: number | null = null;
    if (botId) {
      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (bot) {
        botName = bot.name;
        trustScore = bot.trustScore;
      }
    }

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    // Header
    doc.fontSize(22).font("Helvetica-Bold").text("PayJarvis", 50, 50);
    doc.fontSize(8).font("Helvetica").fillColor("#888888").text("Bot Payment Identity", 50, 75);
    doc.fillColor("#000000");
    doc.moveDown(2);
    doc.fontSize(14).font("Helvetica-Bold").text("Extrato de Transações");
    doc.moveDown(0.5);
    doc.fontSize(9).font("Helvetica");
    doc.text(`Bot: ${botName}`);
    if (dateFrom || dateTo) {
      doc.text(`Período: ${dateFrom ?? "início"} até ${dateTo ?? "hoje"}`);
    }
    doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}`);
    doc.moveDown(1.5);

    // Table header
    const tableTop = doc.y;
    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Data", 50, tableTop, { width: 70 });
    doc.text("Merchant", 120, tableTop, { width: 110 });
    doc.text("Categoria", 230, tableTop, { width: 70 });
    doc.text("Valor", 300, tableTop, { width: 70, align: "right" });
    doc.text("Decisão", 380, tableTop, { width: 80 });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(460, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.3);

    // Table rows
    doc.font("Helvetica").fontSize(7.5);
    let totalApproved = 0;
    let totalBlocked = 0;
    let countApproved = 0;
    let countBlocked = 0;

    for (const tx of transactions) {
      if (doc.y > 720) doc.addPage();
      const y = doc.y;
      doc.text(new Date(tx.createdAt).toLocaleDateString("pt-BR"), 50, y, { width: 70 });
      doc.text(tx.merchantName.slice(0, 20), 120, y, { width: 110 });
      doc.text(tx.category, 230, y, { width: 70 });
      doc.text(`${tx.currency} ${tx.amount.toFixed(2)}`, 300, y, { width: 70, align: "right" });
      const decisionColor = tx.decision === "APPROVED" ? "#22c55e" : tx.decision === "BLOCKED" ? "#ef4444" : "#eab308";
      doc.fillColor(decisionColor).text(tx.decision, 380, y, { width: 80 });
      doc.fillColor("#000000");
      doc.moveDown(0.3);

      if (tx.decision === "APPROVED") { totalApproved += tx.amount; countApproved++; }
      if (tx.decision === "BLOCKED") { totalBlocked += tx.amount; countBlocked++; }
    }

    // Footer totals
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(460, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.5);
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text(`Total Aprovado: R$ ${totalApproved.toFixed(2)} (${countApproved} transações)`, 50);
    doc.text(`Total Bloqueado: R$ ${totalBlocked.toFixed(2)} (${countBlocked} transações)`, 50);
    doc.text(`Total de Transações: ${transactions.length}`, 50);
    if (trustScore !== null) {
      doc.text(`Trust Score: ${trustScore}`, 50);
    }

    doc.end();

    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename=payjarvis-extrato-${botId ?? "all"}-${dateFrom ?? "all"}.pdf`)
      .send(pdfBuffer);
  });
}
