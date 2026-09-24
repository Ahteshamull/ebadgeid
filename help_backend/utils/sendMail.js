const transporter = require("./gmailTransport");

const sendMail = async (to, subject, text) => {
  const mailOptions = {
    from: `"Support Desk" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendMail;
