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
    const member = await Member.findOne({ personMobile: req.params.mobile });
    if (!member) return res.status(404).send("Member not found");

    const receipts = await Receipt.find({ mobile: req.params.mobile }).sort({
      created_at: 1,
    });

    const auctions = await Auction.find({
      groupName: member.groupName,
    }).sort({ auctionDate: 1 });

    const basePremium = Number(member.personPremium);

    const premiumMap = {};
    auctions.forEach((a) => {
      const d = new Date(a.auctionDate);
      premiumMap[`${d.getMonth() + 1}-${d.getFullYear()}`] =
        Number(a.perPersonFinal || basePremium);
    });

    const months = [];
    let cursor = new Date(member.createdAt);
    cursor.setDate(1);

    while (cursor <= new Date()) {
      const key = `${cursor.getMonth() + 1}-${cursor.getFullYear()}`;
      months.push({
        label: cursor.toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
        premium: premiumMap[key] || basePremium,
        paid: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

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

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=Ledger.pdf");
    doc.pipe(res);

    doc.font("Helvetica-Bold").fontSize(18).text("SRI SAI BANGARAMMA", {
      align: "center",
    });
    doc.fontSize(13).text("LEDGER STATEMENT", { align: "center" });
    doc.end();
  } catch (err) {
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
