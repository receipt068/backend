require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());
app.use(cors());

/* ================= DATABASE ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Failed");
    console.error(err.message);
    process.exit(1);
  });

/* ================= MEMBER ================= */
const memberSchema = new mongoose.Schema(
  {
    groupName: String,
    personName: String,
    personMobile: String,
    personAddress: String,
    aadharPath: String,
    personPremium: Number,
    premiumMonths: Number,
    referenceName: String,
    referenceContact: String,
    userId: String,
    password: String,
    createdAt: Date,
  },
  { collection: "members" }
);
const Member = mongoose.model("Member", memberSchema);

/* ================= RECEIPTS ================= */
const receiptSchema = new mongoose.Schema(
  {
    customerName: String,
    mobile: String,
    groupName: String,
    collectionDate: String,
    receiptNo: String,
    cashAmount: Number,
    onlineAmount: Number,
    collectionAgent: String,
    receivedTo: String,
    created_at: Date,
  },
  { collection: "receipts" }
);
const Receipt = mongoose.model("Receipt", receiptSchema);

/* ================= AUCTIONS ================= */
const auctionSchema = new mongoose.Schema(
  {
    groupName: String,
    memberName: String,
    premiumAmount: Number,
    auctionAmount: Number,
    commissionPercent: Number,
    companyCommission: Number,
    bonusAmount: Number,
    bonusPerPerson: Number,
    finalAmountToCollect: Number,
    perPersonFinal: Number,
    winningAmount: Number,
    totalGroupMembers: Number,
    auctionDate: Date,
  },
  { collection: "auction_entry" }
);
const Auction = mongoose.model("Auction", auctionSchema);

/* ================= NOTIFICATIONS ================= */
/* ================= NOTIFICATIONS ================= */
const notificationSchema = new mongoose.Schema(
  {
    message: String,
  },
  { timestamps: true }
);

const Notification = mongoose.model(
  "Notification",
  notificationSchema,
  "notification" // 👈 IMPORTANT
);

/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
  try {
    const { userId, password } = req.body;
    const hashed = crypto
      .createHash("sha256")
      .update(password)
      .digest("base64");

    const member = await Member.findOne({ userId, password: hashed });
    if (!member)
      return res.status(401).json({ message: "Invalid credentials" });

    res.json({ success: true, member });
  } catch {
    res.status(500).json({ message: "Login error" });
  }
});

/* ================= PAYMENTS ================= */
app.get("/payments/:mobile", async (req, res) => {
  const receipts = await Receipt.find({ mobile: req.params.mobile }).sort({
    created_at: 1,
  });
  res.json({ success: true, payments: receipts });
});

/* ================= AUCTIONS ================= */
app.get("/auctions/:group", async (req, res) => {
  const auctions = await Auction.find({ groupName: req.params.group }).sort({
    auctionDate: 1,
  });
  res.json({ success: true, auctions });
});

/* ================= LEDGER PDF ================= */
app.get("/ledger-pdf-v2/:mobile", async (req, res) => {
  try {
    const { from, to } = req.query;

    const member = await Member.findOne({
      personMobile: req.params.mobile,
    });
    if (!member) return res.status(404).send("Member not found");

    const receipts = await Receipt.find({
      mobile: req.params.mobile,
    }).sort({ created_at: 1 });

    const auctions = await Auction.find({
      groupName: member.groupName,
    }).sort({ auctionDate: 1 });

    const basePremium = Number(member.personPremium);

    /* ---------- Auction Premium Map ---------- */
    const premiumMap = {};
    auctions.forEach((a) => {
      const d = new Date(a.auctionDate);
      premiumMap[`${d.getMonth()}-${d.getFullYear()}`] =
        Number(a.perPersonFinal || basePremium);
    });

    /* ---------- Build Months ---------- */
    const months = [];
    let cursor = new Date(member.createdAt);
    cursor.setDate(1);

    const end = new Date();

    while (cursor <= end) {
      const m = cursor.getMonth();
      const y = cursor.getFullYear();
      const key = `${m}-${y}`;

      months.push({
        date: new Date(cursor),
        label: cursor.toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
        premium: premiumMap[key] || basePremium,
        paid: 0,
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    /* ---------- FIFO Payments ---------- */
    receipts.forEach((r) => {
      let amt = (r.cashAmount || 0) + (r.onlineAmount || 0);
      for (let m of months) {
        if (amt <= 0) break;
        const bal = m.premium - m.paid;
        if (bal > 0) {
          const used = Math.min(bal, amt);
          m.paid += used;
          amt -= used;
        }
      }
    });

    /* ---------- Apply From / To Filter ---------- */
    const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();

    let filtered = months;

    if (from) {
      const f = new Date(from);
      filtered = filtered.filter(
        (m) => monthIndex(m.date) >= monthIndex(f)
      );
    }

    if (to) {
      const t = new Date(to);
      filtered = filtered.filter(
        (m) => monthIndex(m.date) <= monthIndex(t)
      );
    }

    /* ---------- PDF ---------- */
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "inline; filename=Ledger.pdf"
    );

    doc.pipe(res);

    /* ---------- Header ---------- */
    doc.font("Helvetica-Bold").fontSize(18).text(
      "SRI SAI BANGARAMMA",
      { align: "center" }
    );
    doc.fontSize(13).text("LEDGER STATEMENT", { align: "center" });
    doc.moveDown(1);

    doc.fontSize(10).font("Helvetica");
    doc.text(`Member : ${member.personName}`);
    doc.text(`Group  : ${member.groupName}`);
    doc.text(`Mobile : ${member.personMobile}`);
    doc.text(`Premium: ₹${basePremium}`);
    doc.text(`Date   : ${new Date().toLocaleDateString()}`);
    doc.moveDown(1);

    if (from || to) {
      doc
        .fontSize(9)
        .fillColor("gray")
        .text(
          `Period: ${from ? new Date(from).toLocaleDateString() : "Start"} 
           to ${to ? new Date(to).toLocaleDateString() : "Till Date"}`,
          { align: "center" }
        );
      doc.moveDown(1);
    }

    /* ---------- Table Header ---------- */
    const COL = {
      month: 40,
      premium: 220,
      paid: 300,
      pending: 380,
      running: 460,
    };

    let y = doc.y;

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Month", COL.month, y);
    doc.text("Premium", COL.premium, y, { width: 70, align: "right" });
    doc.text("Paid", COL.paid, y, { width: 70, align: "right" });
    doc.text("Pending", COL.pending, y, { width: 70, align: "right" });
    doc.text("Running Due", COL.running, y, {
      width: 80,
      align: "right",
    });

    y += 14;
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 8;

    /* ---------- Table Rows ---------- */
    doc.font("Helvetica").fontSize(10);

    let runningDue = 0;

    filtered.forEach((m) => {
      const due = Math.max(m.premium - m.paid, 0);
      runningDue += due;

      doc.text(m.label, COL.month, y);
      doc.text(`₹${m.premium}`, COL.premium, y, {
        width: 70,
        align: "right",
      });
      doc.text(`₹${m.paid}`, COL.paid, y, {
        width: 70,
        align: "right",
      });
      doc.text(`₹${due}`, COL.pending, y, {
        width: 70,
        align: "right",
      });
      doc.text(`₹${runningDue}`, COL.running, y, {
        width: 80,
        align: "right",
      });

      y += 18;

      if (y > 740) {
        doc.addPage();
        y = 50;
      }
    });

    /* ---------- Footer ---------- */
    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor("gray")
      .text(
        "This is a system generated ledger. All payments are subject to auction and carry-forward rules.",
        { align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).send("PDF generation failed");
  }
});


/* ================= ADD NOTIFICATION (ADMIN) ================= */
app.post("/notifications", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message)
      return res.status(400).json({ success: false, message: "Message required" });

    const notification = await Notification.create({ message });
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================= GET NOTIFICATIONS ================= */
app.get("/notifications", async (req, res) => {
  try {
    const notifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      notifications,
    });
  } catch (err) {
    console.error("NOTIFICATION FETCH ERROR:", err);
    res.status(500).json({
      success: false,
      notifications: [],
    });
  }
});

/* ================= START ================= */
app.listen(3000, () => console.log("🚀 Server running on 3000"));
