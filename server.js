require('dotenv').config();  // Import configuration from .env file

const express = require('express');
const { Sequelize, Op } = require('sequelize');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const xlsx = require('xlsx');  // For reading Excel files
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // Import multer for file uploads
const bcrypt = require('bcryptjs');
const session = require('express-session');
const client = require('prom-client');

// Default metrics collection (CPU, memory, event loop, dll)
client.collectDefaultMetrics();
const register = client.register;

// Optional: custom metrics (HTTP request counter)
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const app = express();
const port = process.env.PORT || 5000;  // Get port from .env or default to 5000

// Setup PostgreSQL connection using variables from .env
const sequelize = new Sequelize(`postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`);

// Middleware for parsing JSON
const corsOptions = {
  origin: '*',  // Ganti dengan alamat frontend kamu
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));  // Menambahkan pengaturan CORS ke server
app.use(express.json());
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.labels(req.method, req.path, res.statusCode).inc();
  });
  next();
});


// Setup view engine for CMS UI
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));


app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: true,
}));

// User model
const User = sequelize.define('User', {
  id: {
    type: Sequelize.UUID,       // Menggunakan UUID sebagai tipe data
    defaultValue: Sequelize.UUIDV4,  // Menggunakan UUIDV4 secara otomatis
    primaryKey: true,           // Menetapkan sebagai primary key
    allowNull: false,           // Tidak boleh null
  },
  username: {
    type: Sequelize.STRING,
    unique: true,
    allowNull: false,
  },
  password: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  email: {
    type: Sequelize.STRING,
    unique: true,
    allowNull: false,
  },
});

// Product model
const Product = sequelize.define('Product', {
  reference: { type: Sequelize.STRING, primaryKey: true },
  brand: Sequelize.STRING,
  product_name: Sequelize.STRING,
  variant: Sequelize.STRING,
  category: Sequelize.STRING,
  price: Sequelize.INTEGER,
  discount_percentage: Sequelize.FLOAT,
  stock: Sequelize.INTEGER,
  ean_number: Sequelize.STRING,
  url: Sequelize.STRING,
  description: Sequelize.TEXT,
  final_price: Sequelize.FLOAT,
});

// ProductImage model
const ProductImage = sequelize.define('ProductImage', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  reference: {
    type: Sequelize.STRING,
    allowNull: false,
    references: {
      model: Product,
      key: 'reference'
    }
  },
  image_path: Sequelize.STRING
});

// Relationship between Product and ProductImage
Product.hasMany(ProductImage, { foreignKey: 'reference' });
ProductImage.belongsTo(Product, { foreignKey: 'reference' });

// Sinkronisasi database
sequelize.sync({ force: false })
  .then(() => console.log('Database synced'))
  .catch((err) => console.error('Error syncing database:', err));

// Function untuk autentikasi JWT
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization') && req.header('Authorization').split(' ')[1];

  if (!token) return res.status(401).send('Access Denied');

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send('Invalid Token');
    req.user = user;
    next();
  });
};

// Function untuk catat log ketika proses import berjalan ada kegagalan
const writeLog = (message) => {
  const logFilePath = path.join(__dirname, 'import_log.txt');
  fs.appendFileSync(logFilePath, message + '\n');
};

// Function untuk proses import data dari Excel
const importDataFromExcel = async (filePath) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(filePath)) {
        reject(new Error('File not found'));
        return;
      }

      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

      if (data.length === 0) {
        reject(new Error('Excel file is empty'));
        return;
      }

      for (const row of data) {
        const reference = row['Reference'] || row['reference'];
        if (!reference) continue;

        let stock = row['Stock'] === '' ? 0 : row['Stock'];
        const productData = {
          reference: reference,
          brand: row['Brand'],
          product_name: row['Product Name'],
          variant: row['Variant'],
          category: row['Category'],
          price: row['Price'],
          discount_percentage: row['Discount (%)'] || 0,
          stock: stock,
          ean_number: row['EAN Number'],
          url: row['URL'],
          description: row['Description'],
        };

        // Menghitung harga final berdasarkan diskon
        const finalPrice = productData.price - (productData.price * productData.discount_percentage / 100);
        productData.final_price = finalPrice;  // Menyimpan harga final dalam data produk

        const existingProduct = await Product.findOne({ where: { reference: productData.reference } });

        if (existingProduct) {
          try {
            // Update produk yang sudah ada, termasuk harga final
            await Product.update(productData, { where: { reference: productData.reference } });
            console.log(`Product with reference ${reference} updated successfully`);

            // Hapus gambar lama jika ada
            await ProductImage.destroy({ where: { reference: productData.reference } });

          } catch (error) {
            console.error(`Failed to update product with reference ${reference}: ${error.message}`);
            continue;
          }
        } else {
          try {
            // Simpan produk baru, termasuk harga final
            await Product.create(productData);
            console.log(`Product with reference ${reference} inserted successfully`);
          } catch (error) {
            console.error(`Failed to insert product with reference ${reference}: ${error.message}`);
            continue;
          }
        }

        // Proses gambar jika ada
        if (row['Images']) {
          const images = row['Images'].split(',');
          const productImages = images.map((image) => ({
            reference: reference,
            image_path: image.trim(),
          }));

          // Pastikan urutan gambar sesuai dengan urutan produk yang benar
          productImages.sort((a, b) => a.reference.localeCompare(b.reference));

          // Menyimpan gambar ke dalam database dalam batch per produk
          const batchSize = 10;  // Menyesuaikan ukuran batch
          for (let i = 0; i < productImages.length; i += batchSize) {
            const imageBatch = productImages.slice(i, i + batchSize);
            try {
              await ProductImage.bulkCreate(imageBatch);
              console.log(`Batch ${i / batchSize + 1} of product images imported successfully`);
            } catch (error) {
              console.error(`Error inserting batch ${i / batchSize + 1} of product images: ${error.message}`);
            }
          }
        }
      }

      resolve();
    } catch (err) {
      reject(err);
    }
  });
};

// Function untuk penyimpanan file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/'); // Direktori penyimpanan gambar
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname); // Menyimpan dengan nama asli file
    }
});

// Validasi file type
const fileFilter = (req, file, cb) => {
  // Hanya izinkan file dengan ekstensi .xlsx
  const ext = path.extname(file.originalname);
  if (ext !== '.xlsx') {
    return cb(new Error('Invalid file type, only .xlsx files are allowed'), false);
  }
  cb(null, true);  // Jika file valid, lanjutkan
};

// Pengaturan multer dengan validasi file type
const upload = multer({ 
  storage: storage, 
  fileFilter: fileFilter 
}).single('file');  // Gunakan single karena hanya mengupload satu file

// Validasi input produk menggunakan Joi
const productValidationSchema = Joi.object({
  reference: Joi.string().required(),
  brand: Joi.string().required(),
  product_name: Joi.string().required(),
  variant: Joi.string().required(),
  category: Joi.string().required(),
  price: Joi.number().integer().required(),
  discount_percentage: Joi.number().min(0).max(100).required(),
  stock: Joi.number().integer().required(),
  ean_number: Joi.string().required(),
  url: Joi.string().uri().required(),
  description: Joi.string().optional(),
  images: Joi.array().items(Joi.string()).optional(), // Validasi path gambar
});

// Endpoint untuk membuat user baru
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;

  // Validasi input
  if (!username || !password || !email) {
    return res.status(400).send('All fields are required');
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Simpan user ke database
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).send('Error creating user');
  }
});

// Endpoint untuk login dan mendapatkan JWT token
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  const user = await User.findOne({ where: { username } });

  if (!user) {
    return res.status(404).send('User not found');
  }

  // Cek password
  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    return res.status(400).send('Invalid credentials');
  }

  // Generate JWT token
  const token = jwt.sign({ username: user.username, id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  res.json({ token });
});

// Endpoint untuk mendapatkan semua user
app.get('/api/users', authenticateJWT, async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Error fetching users');
  }
});

// Endpoint untuk mendapatkan data user berdasarkan UUID
app.get('/api/users/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;  // Mengambil UUID dari parameter

  try {
    // Mengambil user berdasarkan UUID
    const user = await User.findOne({ where: { id } });

    if (!user) {
      return res.status(404).send('User not found');
    }

    // Mengembalikan data user
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk menghapus user
app.delete('/api/users/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).send('User not found');
    }

    // Menghapus user dari database
    await user.destroy();
    res.status(200).send('User deleted successfully');
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).send('Error deleting user');
  }
});

// Endpoint untuk mengubah password
app.patch('/api/users/:id/password', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const { oldPassword, newPassword } = req.body;

  // Validasi input
  if (!oldPassword || !newPassword) {
    return res.status(400).send('Old password and new password are required');
  }

  try {
    // Mencari user berdasarkan UUID
    const user = await User.findOne({ where: { id } });

    if (!user) {
      return res.status(404).send('User not found');
    }

    // Verifikasi password lama
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);

    if (!isOldPasswordValid) {
      return res.status(400).send('Old password is incorrect');
    }

    // Hash password baru
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password di database
    await user.update({ password: hashedNewPassword });

    res.status(200).send('Password updated successfully');
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk mendapatkan semua brand
app.get('/api/brands', async (req, res) => {
  try {
    const brands = await Product.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('brand')), 'brand']]
    });
    res.json(brands.map(brand => brand.brand));
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk mendapatkan semua kategori
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Product.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('category')), 'category']],
      where: {
        category: { [Sequelize.Op.ne]: null }
      }
    });
    const categoryList = categories.map(c => c.category);
    res.json(categoryList);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk mendapatkan semua produk dengan pagination dan filter
app.get('/api/products', async (req, res) => {
  const { page = 1, limit = 10, brand, category, sort, search } = req.query;
  const offset = (page - 1) * limit;  // Hitung offset berdasarkan halaman yang diminta

  try {
    // Persiapkan filter produk
    let whereConditions = {};

    // Tambahkan filter brand jika ada
    if (brand && brand !== 'All Brands') {
      whereConditions.brand = brand;
    }

    // Tambahkan filter category jika ada
    if (category && category !== 'All Category') {
      whereConditions.category = category;
    }

    if (search) {
      whereConditions.product_name = {
        [Op.iLike]: `%${search}%`
      };
    }
    
    // Tentukan urutan berdasarkan parameter sort (stok lebih dulu, baru acak atau harga)
    let orderConditions = [
      // Pertama, urutkan berdasarkan stok (produk dengan stok > 0 muncul lebih dulu)
      [Sequelize.literal('CASE WHEN stock > 0 THEN 0 ELSE 1 END'), 'ASC'],  // Stok yang tersedia dulu
    ];

    // Urutkan produk yang tersedia stoknya secara acak (jika tidak ada parameter harga)
    if (!sort) {
      orderConditions.push([Sequelize.fn('RANDOM')]);  // Urutkan produk dengan stok yang ada secara acak
    }

    // Tambahkan urutan berdasarkan harga jika parameter sort ada
    if (sort) {
      if (sort === 'asc') {
        orderConditions.push(['final_price', 'ASC']);  // Harga dari termurah ke termahal
      } else if (sort === 'desc') {
        orderConditions.push(['final_price', 'DESC']);  // Harga dari termahal ke termurah
      }
    }

    // Ambil data produk dengan filter dan pagination, hanya menampilkan field yang diperlukan
    const products = await Product.findAll({
      where: whereConditions,  // Terapkan filter
      offset: offset,
      limit: parseInt(limit),
      order: orderConditions,  // Terapkan urutan berdasarkan stok, acak atau harga
      attributes: {
        exclude: ['ean_number', 'url', 'description'], // Mengecualikan field ean_number, url, dan description
      },
    });

    // Mengambil jumlah total produk untuk menghitung total halaman (dengan filter yang sama)
    const totalItems = await Product.count({ where: whereConditions });
    const totalPages = Math.ceil(totalItems / limit);  // Menghitung total halaman

    // Mengambil gambar yang terhubung dengan setiap produk
    const productsWithImages = await Promise.all(products.map(async (product) => {
      const images = await ProductImage.findAll({ where: { reference: product.reference } });
      const imageUrls = images.map(image => image.image_path);
      return {
        ...product.toJSON(),
        images: imageUrls,  // Sertakan daftar gambar dalam respons produk
        final_price: product.final_price,  // Sertakan final_price dalam respons
      };
    }));

    // Mengembalikan produk yang sudah dipaginasikan beserta informasi gambar dan harga final
    res.json({
      products: productsWithImages,  // Daftar produk yang sudah dilengkapi gambar dan harga final
      totalItems,  // Jumlah total produk
      totalPages,  // Jumlah total halaman
      currentPage: page,  // Halaman saat ini
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk mendapatkan produk berdasarkan reference
app.get('/api/products/:reference', authenticateJWT, async (req, res) => {
  try {
    const reference = req.params.reference;

    // Mengambil produk berdasarkan reference
    const product = await Product.findOne({ where: { reference: reference } });

    if (!product) {
      return res.status(404).send('Product not found');
    }

    // Mengambil semua gambar yang terhubung dengan produk
    const images = await ProductImage.findAll({ where: { reference: product.reference } });
    const imageUrls = images.map(image => image.image_path);

    res.json({
      ...product.toJSON(),
      images: imageUrls  // Sertakan daftar gambar dalam respons produk
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk menambah produk satuan
app.post('/api/products', authenticateJWT, async (req, res) => {
  // Validasi input menggunakan Joi
  const { error } = productValidationSchema.validate(req.body);
  if (error) {
    return res.status(400).send(error.details[0].message); // Mengirimkan error jika input tidak valid
  }

  try {
    const { reference, brand, product_name, variant, category, price, discount_percentage, stock, ean_number, url, description, images } = req.body;
    
    // Menyimpan produk ke database
    const newProduct = await Product.create({
      reference,
      brand,
      product_name,
      variant,
      category,
      price,
      discount_percentage,
      stock,
      ean_number,
      url,
      description,
    });

    // Menyimpan gambar-gambar terkait produk ke tabel ProductImage jika ada
    if (images && Array.isArray(images)) {
      for (let image of images) {
        await ProductImage.create({
          reference: newProduct.reference,  // Relasi dengan produk
          image_path: image,  // Menyimpan path gambar
        });
      }
    }

    res.status(201).json(newProduct);  // Mengembalikan produk yang baru ditambahkan dalam format JSON
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).send('Server error');
  }
});

// Endpoint untuk menghapus produk berdasarkan reference
app.delete('/api/products/:reference', authenticateJWT, async (req, res) => {
  try {
    const { reference } = req.params;

    // Hapus gambar-gambar terkait terlebih dahulu
    await ProductImage.destroy({ where: { reference } });

    // Hapus produk
    const deleted = await Product.destroy({ where: { reference } });

    if (deleted === 0) {
      return res.status(404).send('Product not found');
    }

    res.status(200).send('Product deleted successfully');
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).send('Server error');
  }
});


// Endpoint untuk mengimpor produk dari Excel
app.post('/api/import', authenticateJWT, upload, (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const filePath = req.file.path;  // Path file yang diupload

  // Panggil fungsi untuk mengimpor data
  importDataFromExcel(filePath)
    .then(() => {
      // Jika data berhasil diimpor, kirimkan respons sukses
      res.status(200).send('Data imported successfully');
    })
    .catch((err) => {
      // Jika ada error (misal file tidak ditemukan), kirimkan error response
      console.error(err); // Menampilkan error ke console untuk debugging
      res.status(500).send('Error importing data: ' + err.message); // Mengirimkan error dengan pesan yang lebih jelas
    });
});

// ==== CMS EJS ROUTES ====
const adminCMSRoutes = require('./routes/adminCMS');
app.use('/', adminCMSRoutes);

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = app;

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
