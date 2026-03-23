const express = require('express');
const request = require('supertest');

const app = express();
app.get('/', (req, res, next) => {
  try {
    const offset = parseInt(req.query.offset, 10);
    res.json({ offset });
  } catch (e) {
    next(e);
  }
});
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

request(app)
  .get('/?offset[toString]=1')
  .expect(500)
  .end((err, res) => {
    console.log("Response:", res.body);
  });
