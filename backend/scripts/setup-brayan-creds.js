const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dns = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);
const uri = 'mongodb+srv://elena:elena@elena.1igq06i.mongodb.net/ebadgeid?retryWrites=true&w=majority&appName=elena';

async function main() {
  await mongoose.connect(uri);
  const hashedPassword = await bcrypt.hash('eBadgeAdmin2026!', 12);

  // 1. Update personal account with known password
  await mongoose.connection.collection('auths').updateOne(
    { username: 'ahteshamulhasan2@gmail.com' },
    { $set: { password: hashedPassword, activation_token_hash: null } }
  );

  // 2. Create Brayan demo account
  await mongoose.connection.collection('auths').updateOne(
    { username: 'brayan@ebadgeid.com' },
    { $set: { password: hashedPassword, user_role: 'platform_admin', activation_token_hash: null } },
    { upsert: true }
  );

  await mongoose.connection.collection('users').updateOne(
    { username: 'brayan@ebadgeid.com' },
    {
      $set: {
        username: 'brayan@ebadgeid.com',
        email: 'brayan@ebadgeid.com',
        first_name: 'Brayan',
        last_name: 'Admin',
        organization_code: 'SUPER_AD_ORG',
        designation: 'Platform Administrator',
        status: 'active',
      },
    },
    { upsert: true }
  );

  console.log('SUCCESS: Demo credentials configured!');
  await mongoose.disconnect();
}

main().catch(console.error);
