require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const app = express();

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// In-memory storage
let submissions = [];

// Admin config
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.admin) {
    return next();
  }
  res.redirect('/admin');
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/submit-request', upload.single('paymentProof'), (req, res) => {
  try {
    const { telegramUsername, transactionId } = req.body;
    if (!telegramUsername || !telegramUsername.startsWith('@')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram username must start with @' 
      });
    }

    const paymentProof = req.file ? '/uploads/' + req.file.filename : null;
    submissions.push({
      id: Date.now().toString(),
      telegramUsername: telegramUsername.trim(),
      transactionId: transactionId ? transactionId.trim() : null,
      paymentProof,
      timestamp: new Date(),
      status: 'pending',
      ipAddress: req.ip
    });

    console.log(`New submission from ${telegramUsername}`);
    res.json({ success: true, message: 'Request submitted successfully' });
  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// Admin
app.get('/admin/login', (req, res) => {
  res.render('admin-login', { 
    error: null,
    username: ''
  });
});


app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.admin = true;
    res.redirect('/admin/dashboard');
  } else {
    res.render('admin-login', { 
      error: 'Invalid password',
      username: req.body.username || ''
    });
  }
});

app.get('/admin/dashboard', requireAuth, (req, res) => {
  res.render('admin-dashboard', {
    submissions: submissions.sort((a, b) => b.timestamp - a.timestamp),
    moment
  });
});

app.post('/admin/update-status', requireAuth, (req, res) => {
  const { id, status } = req.body;
  const validStatuses = ['pending', 'approved', 'rejected'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  const submissionIndex = submissions.findIndex(s => s.id === id);
  if (submissionIndex !== -1) {
    submissions[submissionIndex].status = status;
    submissions[submissionIndex].processedAt = new Date();
    submissions[submissionIndex].processedBy = req.session.username || 'admin';
    return res.json({ success: true });
  }

  res.status(404).json({ success: false, error: 'Submission not found' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
