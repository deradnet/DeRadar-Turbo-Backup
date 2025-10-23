import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  auth: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
    secret: Joi.string().allow('').optional(),
  }).required(),
  api: Joi.object({
    enabled: Joi.boolean().required(),
  }).required(),
  database: Joi.object({
    path: Joi.string()
      .required()
      .pattern(/^(\.\/|\/)?[\w\-\/\.]+$/)
      .message('database.path must be a valid absolute or relative Unix path'),
  }).required(),
  antennas: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        url: Joi.string().uri().required(),
        enabled: Joi.boolean().required(),
      }),
    )
    .min(1)
    .required(),
  wallet: Joi.object({
    private_key_name: Joi.string().required(),
    public_key: Joi.string().required(),
    private_key: Joi.object().required(),
  }).required(),
  data: Joi.object({
    encryption_key: Joi.string()
      .hex()
      .length(64)
      .required()
      .messages({
        'string.hex': 'data.encryption_key must be a hexadecimal string',
        'string.length': 'data.encryption_key must be exactly 64 characters (32 bytes)',
      }),
  }).required(),
});
