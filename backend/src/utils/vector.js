// Simple Vector2 helper for pure JS
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

module.exports = {
  clamp
};