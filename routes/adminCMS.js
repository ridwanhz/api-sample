const express = require('express');
const axios = require('axios');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  res.render('login');
});

// Add product page
router.get('/add-product', (req, res) => {
  if (!req.session.token) return res.redirect('/login');
  res.render('add-product');
});

// Handle login form POST
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const response = await axios.post('http://localhost:5000/api/login', { username, password });
    req.session.token = response.data.token;
    res.redirect('/dashboard');
  } catch (err) {
    res.render('login', { error: 'Login gagal!' });
  }
});

// Handle form add product
router.post('/add-product', async (req, res) => {
  if (!req.session.token) return res.redirect('/login');

  try {
    const productData = {
      ...req.body,
      images: req.body.images.split(',').map(img => img.trim())
    };

    await axios.post('http://localhost:5000/api/products', productData, {
      headers: {
        Authorization: `Bearer ${req.session.token}`,
        'Content-Type': 'application/json'
      }
    });

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error adding product:', err.message);
    res.redirect('/add-product');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});



router.post('/edit-product/:reference', async (req, res) => {
  if (!req.session.token) return res.redirect('/login');

  try {
    const updatedData = {
      ...req.body,
      images: req.body.images.split(',').map(img => img.trim())
    };

    await axios.put(`http://localhost:5000/api/products/${req.params.reference}`, updatedData, {
      headers: {
        Authorization: `Bearer ${req.session.token}`,
        'Content-Type': 'application/json'
      }
    });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Update failed:', error.message);
    res.redirect('/dashboard');
  }
});

router.post('/delete-product/:reference', async (req, res) => {
  if (!req.session.token) return res.redirect('/login');

  try {
    await axios.delete(`http://localhost:5000/api/products/${req.params.reference}`, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Delete failed:', error.message);
    res.redirect('/dashboard');
  }
});

router.get('/dashboard', async (req, res) => {
  if (!req.session.token) return res.redirect('/login');

  const search = req.query.search || '';
  const queryParams = search ? `?limit=100&search=${search}` : '?limit=100';

  try {
    const response = await axios.get(`http://localhost:5000/api/products${queryParams}`, {
      headers: { Authorization: `Bearer ${req.session.token}` }
    });

    res.render('dashboard', {
      products: response.data.products,
      search
    });
  } catch (err) {
    res.send('Gagal mengambil data produk');
  }
});

module.exports = router;
