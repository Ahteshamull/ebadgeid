const express = require("express");
const router = express.Router();
const otpController = require("../controllers/otpController");

router.post("/request-otp", otpController.requestOtp);
router.post("/verify-otp", otpController.verifyOtp);

module.exports = router;