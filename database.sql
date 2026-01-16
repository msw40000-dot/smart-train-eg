CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    national_id VARCHAR(14) UNIQUE NOT NULL,
    mobile VARCHAR(11) UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    address TEXT,
    profile_image TEXT,
    id_front_image TEXT,
    id_back_image TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    terms_accepted BOOLEAN DEFAULT FALSE,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    available_balance DECIMAL(10,2) DEFAULT 0.00,
    locked_balance DECIMAL(10,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wallet_transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER REFERENCES wallets(id),
    amount DECIMAL(10,2),
    type VARCHAR(20), -- credit / debit / commission / lock / release
    reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tickets (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER REFERENCES users(id),
    train_number VARCHAR(10) NOT NULL,
    from_station TEXT NOT NULL,
    to_station TEXT NOT NULL,
    trip_date DATE NOT NULL,
    trip_time TIME NOT NULL,
    ticket_type VARCHAR(10) CHECK (ticket_type IN ('QR','Paper')),
    quantity INTEGER DEFAULT 1,
    price_per_ticket DECIMAL(10,2) NOT NULL,
    image_url TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'available', 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id),
    buyer_id INTEGER REFERENCES users(id),
    seller_id INTEGER REFERENCES users(id),
    quantity INTEGER NOT NULL,
    total_price DECIMAL(10,2),
    platform_commission DECIMAL(10,2) DEFAULT 20.00,
    payment_status VARCHAR(20) DEFAULT 'pending',
    order_status VARCHAR(30) DEFAULT 'initiated',
    gps_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE paymob_payments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    paymob_order_id BIGINT,
    transaction_id BIGINT,
    amount DECIMAL(10,2),
    success BOOLEAN DEFAULT FALSE,
    raw_response JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gps_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6),
    context VARCHAR(30), -- buy / sell / tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE disputes (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    raised_by INTEGER REFERENCES users(id),
    reason TEXT,
    status VARCHAR(20) DEFAULT 'open',
    resolution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE train_tracking (
    id SERIAL PRIMARY KEY,
    train_number VARCHAR(10),
    current_lat DECIMAL(9,6),
    current_lng DECIMAL(9,6),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
