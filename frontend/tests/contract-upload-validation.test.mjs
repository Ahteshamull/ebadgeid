import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONTRACT_FILE_SIZE,
  validateContractDocumentFile,
  validateAttachmentFile
} from '../src/lib/contract-upload-utils.mjs';

test('validateContractDocumentFile passes valid PDF under 10 MB', () => {
  const validFile = {
    name: 'partnership_agreement.pdf',
    size: 2 * 1024 * 1024,
    type: 'application/pdf'
  };

  const result = validateContractDocumentFile(validFile);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('validateContractDocumentFile rejects files exceeding 10 MB limit', () => {
  const oversizedFile = {
    name: 'large_contract.pdf',
    size: 11 * 1024 * 1024,
    type: 'application/pdf'
  };

  const result = validateContractDocumentFile(oversizedFile);
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds the 10 MB limit/);
});

test('validateContractDocumentFile rejects non-PDF files like docx, exe, mp4', () => {
  const docxFile = {
    name: 'contract.docx',
    size: 1 * 1024 * 1024,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };

  const result = validateContractDocumentFile(docxFile);
  assert.equal(result.valid, false);
  assert.match(result.error, /must be in PDF format/);
});

test('validateContractDocumentFile handles missing file safely', () => {
  const result = validateContractDocumentFile(null);
  assert.equal(result.valid, false);
  assert.match(result.error, /Please select a contract document/);
});

test('validateAttachmentFile validates allowed extensions (PDF, PNG, JPG, WEBP, SVG)', () => {
  const validPng = { name: 'annex_a.png', size: 500 * 1024, type: 'image/png' };
  const validPdf = { name: 'schedule_1.pdf', size: 1024 * 1024, type: 'application/pdf' };
  const invalidDocx = { name: 'notes.docx', size: 200 * 1024, type: 'application/msword' };

  assert.equal(validateAttachmentFile(validPng).valid, true);
  assert.equal(validateAttachmentFile(validPdf).valid, true);
  assert.equal(validateAttachmentFile(invalidDocx).valid, false);
  assert.match(validateAttachmentFile(invalidDocx).error, /unsupported format/);
});

test('validateAttachmentFile rejects attachments over 10 MB', () => {
  const oversized = { name: 'heavy_presentation.pdf', size: 15 * 1024 * 1024 };
  const result = validateAttachmentFile(oversized);
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds the 10 MB limit/);
});
