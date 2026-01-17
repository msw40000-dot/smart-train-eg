import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";

dotenv.config();
const { Pool } = pg;

const app = express();
app.use(cors());
app.use(express.json());

/* =======================
   DATABASE
======================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* =======================
   HELPERS
======================= */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, national_id: user.national_id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* =======================
   REGISTER
======================= */
app.post("/api/register", async (req, res) => {
  const {
    fullName,
    nationalId,
    password,
    mobile,
    address,
    termsAccepted,
  } = req.body;

  if (nationalId.length !== 14)
    return res.status(400).json({ error: "National ID must be 14 digits" });

  if (password.length !== 6)
    return res.status(400).json({ error: "Password must be 6 digits" });

  if (!termsAccepted)
    return res.status(400).json({ error: "Terms must be accepted" });

  try {
    const hash = await bcrypt.hash(password, 10);

    const user = await pool.query(
      `INSERT INTO users
      (full_name, national_id, password_hash, mobile, address, terms_accepted)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, national_id`,
      [fullName, nationalId, hash, mobile, address, termsAccepted]
    );

    await pool.query(
      "INSERT INTO wallets (user_id) VALUES ($1)",
      [user.rows[0].id]
    );

    res.json({ token: generateToken(user.rows[0]) });
  } catch {
    res.status(500).json({ error: "User already exists" });
  }
});

/* =======================
   LOGIN
======================= */
app.post("/api/login", async (req, res) => {
  const { nationalId, password } = req.body;

  const user = await pool.query(
    "SELECT * FROM users WHERE national_id=$1",
    [nationalId]
  );

  if (!user.rows.length)
    return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(
    password,
    user.rows[0].password_hash
  );

  if (!valid)
    return res.status(400).json({ error: "Invalid credentials" });

  res.json({ token: generateToken(user.rows[0]) });
});

/* =======================
   GPS CHECK
======================= */
app.post("/api/gps-check", auth, (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng)
    return res.status(403).json({
      error: "Access to GPS is required for security",
    });

  res.json({ success: true });
});

/* =======================
   WALLET
======================= */
app.get("/api/wallet", auth, async (req, res) => {
  const w = await pool.query(
    "SELECT * FROM wallets WHERE user_id=$1",
    [req.user.id]
  );
  res.json(w.rows[0]);
});

/* =======================
   CREATE TICKET
======================= */
app.post("/api/tickets", auth, async (req, res) => {
  const {
    from,
    to,
    price,
    type,
    imageUrl,
    count,
    tripStart,
    durationMinutes,
    lat,
    lng,
  } = req.body;

  if (!lat || !lng)
    return res.status(403).json({
      error: "Access to GPS is required for security",
    });

  if (!imageUrl)
    return res.status(400).json({ error: "Ticket image required" });

  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO tickets
      (seller_id, from_station, to_station, price, type,
       image_url, trip_start, trip_duration_minutes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user.id,
        from,
        to,
        price,
        type,
        imageUrl,
        tripStart,
        durationMinutes,
      ]
    );
  }

  res.json({ success: true });
});

/* =======================
   BUY TICKET (CHECKOUT LOGIC)
======================= */
app.post("/api/buy/:id", auth, async (req, res) => {
  const ticketId = req.params.id;

  const t = await pool.query(
    "SELECT * FROM tickets WHERE id=$1 AND status='available'",
    [ticketId]
  );

  if (!t.rows.length)
    return res.status(400).json({ error: "Ticket not available" });

  const ticket = t.rows[0];
  const platformFee = 10;

  await pool.query(
    `UPDATE wallets
     SET locked_balance = locked_balance + $1
     WHERE user_id=$2`,
    [ticket.price - platformFee, ticket.seller_id]
  );

  await pool.query(
    `UPDATE tickets
     SET status='sold', buyer_id=$1
     WHERE id=$2`,
    [req.user.id, ticketId]
  );

  res.json({
    success: true,
    message:
      "Purchase completed. No cancellation or refund allowed.",
  });
});

/* =======================
   TRACK TRIP
======================= */
app.get("/api/trip/:id", auth, async (req, res) => {
  const t = await pool.query(
    "SELECT * FROM tickets WHERE id=$1",
    [req.params.id]
  );

  if (!t.rows.length)
    return res.status(404).json({ error: "Not found" });

  const ticket = t.rows[0];
  const start = new Date(ticket.trip_start);
  const now = new Date();

  const total = ticket.trip_duration_minutes * 60000;
  const elapsed = now - start;

  const progress = Math.min(
    Math.round((elapsed / total) * 100),
    100
  );

  res.json({
    from: ticket.from_station,
    to: ticket.to_station,
    progress,
  });
});

/* =======================
   AUTO RELEASE LOCKED BALANCE
======================= */
setInterval(async () => {
  const now = new Date();

  const tickets = await pool.query(
    `SELECT * FROM tickets
     WHERE status='sold' AND payment_released=false`
  );

  for (const t of tickets.rows) {
    const start = new Date(t.trip_start);
    const half =
      start.getTime() +
      (t.trip_duration_minutes * 60000) / 2;

    if (now.getTime() >= half) {
      await pool.query(
        `UPDATE wallets
         SET available_balance = available_balance + locked_balance,
             locked_balance = 0
         WHERE user_id=$1`,
        [t.seller_id]
      );

      await pool.query(
        "UPDATE tickets SET payment_released=true WHERE id=$1",
        [t.id]
      );
    }
  }
}, 60000);

/* =======================
   SERVER
======================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Smart Train EG Backend Running")
);
