const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: 'Global Error', detail: err.message });
});

request(app)
  .post('/')
  .set('Content-Type', 'application/json')
  .send('{bad_json:')
  .expect(400)
  .end((err, res) => {
    if (err) {
      console.error(err);
      console.log('Response status was:', res.status, 'Body:', res.body);
    } else {
      console.log('OK! Handled natively as 400 without crashing');
    }
  });
