import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  USER_EXPORT_COLUMNS,
  formatUserDataForExport,
  calculateColumnWidths,
  generateUserExcelWorkbook
} from '../src/lib/user-export-utils.mjs';

test('formatUserDataForExport properly maps user fields and trims combined name', () => {
  const users = [
    {
      username: 'john_doe',
      first_name: 'John',
      last_name: 'Doe',
      designation: 'Staff Engineer',
      organization_code: 'CORP_01',
      city: 'Austin',
      state: 'Texas',
      country: 'USA',
      email: 'john.doe@example.com',
      phone: '+1-555-0199',
      status: 'active'
    }
  ];

  const result = formatUserDataForExport(users);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    Username: 'john_doe',
    Name: 'John Doe',
    Designation: 'Staff Engineer',
    Organization: 'CORP_01',
    Location: 'Austin, Texas, USA',
    Email: 'john.doe@example.com',
    Phone: '+1-555-0199',
    Status: 'active'
  });
});

test('formatUserDataForExport handles partial locations and missing properties safely', () => {
  const users = [
    {
      username: 'jane_dev',
      first_name: 'Jane',
      city: 'Berlin',
      country: 'Germany'
    },
    {
      // empty user
    }
  ];

  const result = formatUserDataForExport(users);
  assert.equal(result.length, 2);
  assert.equal(result[0].Name, 'Jane');
  assert.equal(result[0].Location, 'Berlin, Germany');
  assert.equal(result[0].Email, '');
  assert.equal(result[0].Status, '');

  assert.equal(result[1].Username, '');
  assert.equal(result[1].Name, '');
  assert.equal(result[1].Location, '');
});

test('formatUserDataForExport correctly handles UTF-8 characters and special symbols', () => {
  const users = [
    {
      username: 'ahsan_h',
      first_name: 'আহসান',
      last_name: 'হাবীব',
      designation: 'Diseñador & Architect',
      organization_code: 'ORGBD_01',
      city: 'Dhaka',
      country: 'Bangladesh',
      email: 'ahsan+team@example.com',
      status: 'active'
    }
  ];

  const result = formatUserDataForExport(users);
  assert.equal(result[0].Name, 'আহসান হাবীব');
  assert.equal(result[0].Designation, 'Diseñador & Architect');
});

test('calculateColumnWidths respects min width (10) and max width (40)', () => {
  const shortData = [
    {
      Username: 'u1',
      Name: 'A',
      Designation: 'D',
      Organization: 'O',
      Location: 'L',
      Email: 'e@x.co',
      Phone: '1',
      Status: 'ok'
    }
  ];

  const widths = calculateColumnWidths(shortData, USER_EXPORT_COLUMNS);
  for (const col of widths) {
    // Header length + 2, but at least 10
    assert.ok(col.wch >= 10);
    assert.ok(col.wch <= 40);
  }

  const longData = [
    {
      Username: 'a'.repeat(60),
      Name: 'b'.repeat(50),
      Designation: 'c',
      Organization: 'd',
      Location: 'e',
      Email: 'f',
      Phone: 'g',
      Status: 'h'
    }
  ];

  const cappedWidths = calculateColumnWidths(longData, USER_EXPORT_COLUMNS);
  assert.equal(cappedWidths[0].wch, 40); // capped at 40
  assert.equal(cappedWidths[1].wch, 40); // capped at 40
});

test('generateUserExcelWorkbook creates valid workbook even when user list is empty', () => {
  const wb = generateUserExcelWorkbook(XLSX, []);
  assert.ok(wb.SheetNames.includes('Users'));
  const sheet = wb.Sheets['Users'];
  assert.ok(sheet);

  // Write to buffer to verify valid XLSX serialization
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 0);
});

test('generateUserExcelWorkbook creates populated workbook for multiple users', () => {
  const users = [
    { username: 'u1', first_name: 'User', last_name: 'One', email: 'u1@test.com', status: 'active' },
    { username: 'u2', first_name: 'User', last_name: 'Two', email: 'u2@test.com', status: 'inactive' }
  ];

  const wb = generateUserExcelWorkbook(XLSX, users);
  const sheet = wb.Sheets['Users'];
  const json = XLSX.utils.sheet_to_json(sheet);
  assert.equal(json.length, 2);
  assert.equal(json[0].Username, 'u1');
  assert.equal(json[1].Username, 'u2');
});
