const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Organization = require('../models/organization_schema');
const Users = require('../models/user_model');
const User = require('../models/AuthCredentials');

async function seed() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing in .env');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const orgCode = 'SUPER_AD_ORG';
    const email = 'ahteshamulhasan2@gmail.com';
    const username = 'ahteshamulhasan2@gmail.com';
    const rawPassword = '112233';

    // 1. Ensure Super Admin Organization exists
    await Organization.findOneAndUpdate(
      { organization_code: orgCode },
      {
        $set: {
          organization_code: orgCode,
          name: 'Platform Super Admin',
          city: 'Dhaka',
          state: 'Dhaka',
          country: 'Bangladesh',
          email,
          phone: '+8801700000000',
          status: 'ACTIVE',
          plan: 'Enterprise',
          seat_count: 1,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    console.log('Organization SUPER_AD_ORG ready');

    // 2. Ensure User Profile exists
    await Users.findOneAndUpdate(
      { username },
      {
        $set: {
          username,
          organization_code: orgCode,
          first_name: 'Ahteshamul',
          last_name: 'Hasan',
          designation: 'Super Admin',
          city: 'Dhaka',
          state: 'Dhaka',
          country: 'Bangladesh',
          email,
          phone: '+8801700000000',
          status: 'active',
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    console.log('User profile ready for:', username);

    // 3. Ensure Auth Credentials exist with platform_admin role and hashed password
    const hashedPassword = await bcrypt.hash(rawPassword, 12);
    await User.findOneAndUpdate(
      { username },
      {
        $set: {
          username,
          password: hashedPassword,
          user_role: 'platform_admin',
        },
        $unset: {
          activation_token_hash: 1,
          activation_expires_at: 1,
          activation_password_preselected: 1,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    console.log('Auth credentials ready for:', username);

    console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
