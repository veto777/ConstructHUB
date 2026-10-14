import { z } from "zod";
import { DIRECTORY_CATEGORIES, DIRECTORY_KINDS } from "@shared/directories";

const multi = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .max(500)
    .transform((value) => value.split(","))
    .pipe(z.array(item).min(1))
    .optional();
const integer = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647));
export const catalogueQuery = z
  .object({
    limit: integer
      .pipe(
        z.union([
          z.literal(10),
          z.literal(25),
          z.literal(50),
          z.literal(100),
          z.literal(250),
        ]),
      )
      .default("25"),
    offset: integer.default("0"),
    q: z.string().trim().max(200).optional(),
    category: multi(z.enum(DIRECTORY_CATEGORIES)),
    tier: multi(z.enum(["1", "2", "3", "4"])),
    kind: multi(z.enum(DIRECTORY_KINDS)),
    grade: multi(z.enum(["A", "B", "C", "X", "ungraded"])),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    trade: z.string().trim().max(100).optional(),
    active: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    link: z.enum(["verified", "unconfirmed"]).optional(),
    paid: z.enum(["true", "false", "unknown"]).optional(),
    dr_min: integer.pipe(z.number().max(100)).optional(),
    dr_max: integer.pipe(z.number().max(100)).optional(),
    sort: z.enum(["name", "dr", "tier", "category", "state"]).default("tier"),
    dir: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict()
  .refine(
    (value) =>
      value.dr_min === undefined ||
      value.dr_max === undefined ||
      value.dr_min <= value.dr_max,
    "DR minimum must not exceed maximum",
  );
export type CatalogueQuery = z.infer<typeof catalogueQuery>;
