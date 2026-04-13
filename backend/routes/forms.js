const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
// Auth middleware is applied in server.js
const { hasPermission, isSuperAdmin } = require('../models/helpers');

const router = express.Router();

// ============================================================================
// GET /forms/fields - Get all form fields
// ============================================================================
router.get(
  "/fields",
  asyncHandler(async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("form_fields")
        .select("*")
        .order("order");

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({
        total: data.length,
        fields: data || [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /forms/fields/:id - Get specific field
// ============================================================================
router.get(
  "/fields/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const { data, error } = await supabaseAdmin
        .from("form_fields")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Field not found" });
      }

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /forms/fields - Add new form field (SuperAdmin only)
// ============================================================================
router.post(
  "/fields",
  [
    body("name").trim().isLength({ min: 1 }),
    body("label").trim().isLength({ min: 1 }),
    body("field_type").isIn(["text", "email", "number", "textarea", "select", "date", "phone"]),
    body("is_required").isBoolean().optional(),
    body("options").isObject().optional(),
    body("order").isInt().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, label, field_type, is_required, options, order } = req.body;
    const userId = req.user.id;

    try {
      // Only SuperAdmin can manage form fields
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Only SuperAdmin can manage form fields" });
      }

      // Get next order if not provided
      let finalOrder = order;
      if (finalOrder === undefined) {
        const { data: lastField } = await supabaseAdmin
          .from("form_fields")
          .select("order")
          .order("order", { ascending: false })
          .limit(1);

        finalOrder = (lastField?.[0]?.order || 0) + 1;
      }

      const { data, error } = await supabaseAdmin
        .from("form_fields")
        .insert({
          name,
          label,
          field_type,
          is_required: is_required || false,
          options: options || null,
          order: finalOrder,
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(201).json({
        message: "Form field created successfully",
        field: data,
      });
    } catch (err) {
      if (err.message.includes("duplicate")) {
        return res.status(400).json({ error: "Field name already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// PUT /forms/fields/:id - Update form field
// ============================================================================
router.put(
  "/fields/:id",
  [
    body("label").trim().optional(),
    body("is_required").isBoolean().optional(),
    body("options").isObject().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { label, is_required, options } = req.body;

    try {
      // Only SuperAdmin can manage form fields
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Only SuperAdmin can manage form fields" });
      }

      const updateData = {};
      if (label) updateData.label = label;
      if (is_required !== undefined) updateData.is_required = is_required;
      if (options !== undefined) updateData.options = options;

      const { data, error } = await supabaseAdmin
        .from("form_fields")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({
        message: "Form field updated successfully",
        field: data,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// DELETE /forms/fields/:id - Delete form field
// ============================================================================
router.delete(
  "/fields/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      // Only SuperAdmin can manage form fields
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Only SuperAdmin can manage form fields" });
      }

      await supabaseAdmin.from("form_fields").delete().eq("id", id);

      res.json({ message: "Form field deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /forms/fields/reorder - Reorder form fields
// ============================================================================
router.post(
  "/fields/reorder",
  [body("fields").isArray()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { fields } = req.body;

    try {
      // Only SuperAdmin can manage form fields
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Only SuperAdmin can manage form fields" });
      }

      // Update order for each field
      for (let i = 0; i < fields.length; i++) {
        await supabaseAdmin
          .from("form_fields")
          .update({ order: i + 1 })
          .eq("id", fields[i]);
      }

      res.json({ message: "Form fields reordered successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

module.exports = router;
