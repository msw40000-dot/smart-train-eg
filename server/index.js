import express from 'express';
import pg from 'pg';
import bcrypt from 'bcrypt';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
import axios from "axios";

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SALT_ROUNDS = 10;

// --- Register API ---
app.post('/api/register', async (req, res) => {
    const { fullName, nationalId, password, mobile, termsAccepted } = req.body;

    if (!fullName || !nationalId || !password || !mobile) {
        return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    if (nationalId.length !== 14) return res.status(400).json({ error: "الرقم القومي لازم 14 رقم" });
    if (password.length !== 6) return res.status(400).json({ error: "كلمة السر لازم 6 أرقام" });
    if (!termsAccepted) return res.status(400).json({ error: "يجب الموافقة على الشروط والأحكام" });

    try {
        // التحقق إذا الرقم القومي أو الموبايل موجود مسبقًا
        const exists = await pool.query(
            'SELECT id FROM users WHERE national_id=$1 OR mobile=$2',
            [nationalId, mobile]
        );
        if (exists.rows.length > 0) {
            return res.status(400).json({ error: "الرقم القومي أو رقم الموبايل مسجل مسبقاً" });
        }

        // تشفير كلمة السر
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // حفظ المستخدم
        const newUser = await pool.query(
            'INSERT INTO users (full_name, national_id, password, mobile, terms_accepted) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [fullName, nationalId, hashedPassword, mobile, termsAccepted]
        );

        // إنشاء محفظة أوتوماتيك
        await pool.query('INSERT INTO wallets (user_id) VALUES ($1)', [newUser.rows[0].id]);

        res.json({ success: true, message: "تم التسجيل وإنشاء المحفظة بنجاح" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "حدث خطأ أثناء التسجيل" });
    }
});

// --- Basic Login API ---
app.post('/api/login', async (req, res) => {
    const { nationalId, password } = req.body;

    if (!nationalId || !password) return res.status(400).json({ error: "الرقم القومي وكلمة السر مطلوبة" });

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE national_id=$1', [nationalId]);
        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "الرقم القومي غير مسجل" });
        }

        const user = userResult.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: "كلمة السر غير صحيحة" });

        res.json({ success: true, message: "تم تسجيل الدخول بنجاح", userId: user.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "حدث خطأ أثناء تسجيل الدخول" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// =======================
// Create Paymob Payment
// =======================
app.post("/api/pay", authMiddleware, async (req, res) => {
  const { ticketId } = req.body;

  const ticketRes = await pool.query(
    "SELECT * FROM tickets WHERE id=$1 AND status='available'",
    [ticketId]
  );

  if (!ticketRes.rows.length)
    return res.status(400).json({ error: "التذكرة غير متاحة" });

  const ticket = ticketRes.rows[0];
  const amountCents = (ticket.price + 10) * 100; // + عمولة المشتري

  try {
    // 1️⃣ Auth Token
    const auth = await axios.post(
      "https://accept.paymob.com/api/auth/tokens",
      { api_key: process.env.PAYMOB_API_KEY }
    );

    // 2️⃣ Create Order
    const order = await axios.post(
      "https://accept.paymob.com/api/ecommerce/orders",
      {
        auth_token: auth.data.token,
        delivery_needed: false,
        amount_cents: amountCents,
        currency: "EGP",
        items: [
          {
            name: "Train Ticket",
            amount_cents: amountCents,
            quantity: 1,
          },
        ],
      }
    );

    // 3️⃣ Payment Key
    const paymentKey = await axios.post(
      "https://accept.paymob.com/api/acceptance/payment_keys",
      {
        auth_token: auth.data.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: order.data.id,
        billing_data: {
          apartment: "NA",
          email: "user@test.com",
          floor: "NA",
          first_name: "Smart",
          last_name: "Train",
          phone_number: "01000000000",
          street: "NA",
          building: "NA",
          city: "Cairo",
          country: "EG",
        },
        currency: "EGP",
        integration_id: process.env.PAYMOB_INTEGRATION_ID,
      }
    );

    res.json({
      iframe_url: `https://accept.paymob.com/api/acceptance/iframes/XXXX?payment_token=${paymentKey.data.token}`,
    });
  } catch (e) {
    res.status(500).json({ error: "Paymob Error" });
  }
});
