const transporter = require("./gmailTransport");

const sendOtpEmail = async (to, otp) => {
  const mailOptions = {
    from: `"Helpdesk Support" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your Helpdesk OTP Code",
    html: `
      <h2>Ticket Access OTP</h2>
      <p>Your OTP is:</p>
      <h3 style="color:blue;">${otp}</h3>
      <p>This code will expire in 10 minutes.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(JSON.stringify({ level: 'info', event: 'otp_email_sent' }));
};

module.exports = sendOtpEmail;
