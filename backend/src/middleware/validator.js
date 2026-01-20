// Simple Schema Validator Middleware
const validate = (schema) => (req, res, next) => {
  const { body } = req;
  const errors = [];

  Object.keys(schema).forEach(key => {
    if (!body[key] && schema[key].required) {
      errors.push(`${key} is required`);
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }
  next();
};

module.exports = { validate };