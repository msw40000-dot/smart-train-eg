import express from 'express';
import pg from 'pg';
import bcrypt from 'bcrypt';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

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
