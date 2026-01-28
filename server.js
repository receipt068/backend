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

    const parseDate = (str) => {
      const [d, m, y] = str.split("-").map(Number);
      return new Date(y, m - 1, d);
    };

    const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

    const member = await Member.findOne({
      personMobile: req.params.mobile,
    });

    if (!member) return res.status(404).send("Member not found");

    const basePremium = Number(member.personPremium);

    const receipts = await Receipt.find({
      mobile: req.params.mobile,
    });

    const auctions = await Auction.find({
      groupName: member.groupName,
    });

    const ledger = {};

    /* ===== Auction months ===== */
    auctions.forEach((a) => {
      const d = new Date(a.auctionDate);
      const key = monthKey(d);

      ledger[key] = {
        date: new Date(d.getFullYear(), d.getMonth(), 1),
        premium: Number(a.perPersonFinal), // ✅ FIXED
        winnerName: a.memberName?.trim(),
        paid: 0,
        autoPaid: 0,
      };
    });

    /* ===== Payments (STRICT MONTH) ===== */
    receipts.forEach((r) => {
      if (!r.collectionDate) return;

      const d = parseDate(r.collectionDate);
      const key = monthKey(d);

      if (!ledger[key]) {
        ledger[key] = {
          date: new Date(d.getFullYear(), d.getMonth(), 1),
          premium: basePremium,
          winnerName: null,
          paid: 0,
          autoPaid: 0,
        };
      }

      ledger[key].paid +=
        Number(r.cashAmount || 0) +
        Number(r.onlineAmount || 0);
    });

    /* ===== AutoPaid only for winner ===== */
    Object.values(ledger).forEach((m) => {
      if (
        m.winnerName &&
        m.winnerName === member.personName.trim()
      ) {
        m.autoPaid = m.premium;
      }
    });

    let rows = Object.values(ledger).sort(
      (a, b) => a.date - b.date
    );

    if (from) rows = rows.filter((r) => r.date >= new Date(from));
    if (to) rows = rows.filter((r) => r.date <= new Date(to));

    /* ===== PDF ===== */
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(16).text("SRI SAI BANGARAMMA", { align: "center" });
    doc.fontSize(12).text("LEDGER STATEMENT", { align: "center" });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Member : ${member.personName}`);
    doc.text(`Group  : ${member.groupName}`);
    doc.text(`Mobile : ${member.personMobile}`);
    doc.text(`Premium: ₹${member.personPremium}`);
    doc.text(`Date   : ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    doc.font("Helvetica-Bold");
    doc.text("Month", 40);
    doc.text("Premium", 180);
    doc.text("Paid", 260);
    doc.text("Pending", 340);
    doc.text("Running Due", 430);
    doc.moveDown(0.5);
    doc.font("Helvetica");

    let runningDue = 0;

    rows.forEach((r) => {
      const paid = r.paid; // ✅ FIXED
      const pending = Math.max(
        r.premium - (r.paid + r.autoPaid),
        0
      );
      runningDue += pending;

      doc.text(
        r.date.toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
        40
      );
      doc.text(`₹${r.premium}`, 180);
      doc.text(`₹${paid}`, 260);
      doc.text(`₹${pending}`, 340);
      doc.text(`₹${runningDue}`, 430);
      doc.moveDown();
    });

    doc.end();
  } catch (err) {
    console.error("Ledger PDF error:", err);
    res.status(500).send("Ledger PDF failed");
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
