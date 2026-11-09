const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Organization = require('../models/organization_schema');
const Users = require('../models/user_model');
const Auth = require('../models/AuthCredentials');

async function activateAccounts() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing in .env');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const accountsToActivate = [
      'gezum@mailinator.com',
      'sewuxohy@mailinator.com'
    ];
    const passwordHash = await bcrypt.hash('112233', 12);

    for (const email of accountsToActivate) {
      // 1. Update user profile status to active
      const userRes = await Users.findOneAndUpdate(
        { email },
        { $set: { status: 'active' } },
        { returnDocument: 'after' }
      );
      if (userRes) {
        console.log(`Updated Users profile for ${email} -> status: active`);
      } else {
        console.log(`Users profile not found for ${email}`);
      }

      // 2. Clear activation token and update password in Auth collection
      const authRes = await Auth.findOneAndUpdate(
        { username: email },
        {
          $set: {
            password: passwordHash,
            user_role: 'admin',
          },
          $unset: {
            activation_token_hash: 1,
            activation_expires_at: 1,
            activation_password_preselected: 1,
          },
        },
        { returnDocument: 'after' }
      );
      if (authRes) {
        console.log(`Activated Auth credentials for ${email} with password '112233'`);
      } else {
        console.log(`Auth credentials not found for ${email}`);
      }

      // 3. Ensure organization status is ACTIVE
      if (userRes?.organization_code) {
        await Organization.findOneAndUpdate(
          { organization_code: userRes.organization_code },
          { $set: { status: 'ACTIVE' } },
          { returnDocument: 'after' }
        );
        console.log(`Organization ${userRes.organization_code} marked as ACTIVE`);
      }
    }

    console.log('--- ALL TARGET ACCOUNTS ACTIVATED SUCCESSFULLY ---');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Activation failed:', err);
    process.exit(1);
  }
}

activateAccounts();
