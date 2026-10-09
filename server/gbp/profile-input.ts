import { z } from 'zod';
const text=z.string().trim().max(300);
const date=z.object({year:z.number().int().min(1).max(9999),month:z.number().int().min(1).max(12).optional(),day:z.number().int().min(1).max(31).optional()}).strict();
const time=z.object({hours:z.number().int().min(0).max(24).optional(),minutes:z.number().int().min(0).max(59).optional(),seconds:z.number().int().min(0).max(59).optional(),nanos:z.literal(0).optional()}).strict();
const day=z.enum(['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']);
const category=z.object({name:z.string().regex(/^categories\/[\w:.-]+$/)}).strict();
export const profileFields=z.object({
  title:text.min(1).optional(),
  phoneNumbers:z.object({primaryPhone:text.optional(),additionalPhones:z.array(text).max(2).optional()}).strict().nullable().optional(),
  websiteUri:z.string().url().max(2048).refine(s=>/^https?:\/\//.test(s)).nullable().optional(),
  storefrontAddress:z.object({revision:z.number().int().optional(),regionCode:z.string().length(2),languageCode:text.optional(),postalCode:text.optional(),sortingCode:text.optional(),administrativeArea:text.optional(),locality:text.optional(),sublocality:text.optional(),addressLines:z.array(text).max(10),recipients:z.array(text).max(10).optional(),organization:text.optional()}).strict().nullable().optional(),
  categories:z.object({primaryCategory:category,additionalCategories:z.array(category).max(9).optional()}).strict().optional(),
  'profile.description':z.string().max(750).nullable().optional(),
  regularHours:z.object({periods:z.array(z.object({openDay:day,openTime:time,closeDay:day,closeTime:time}).strict()).max(100)}).strict().nullable().optional(),
  specialHours:z.object({specialHourPeriods:z.array(z.object({startDate:date,endDate:date.optional(),openTime:time.optional(),closeTime:time.optional(),closed:z.boolean().optional()}).strict()).max(100)}).strict().nullable().optional(),
  serviceArea:z.object({businessType:z.enum(['CUSTOMER_LOCATION_ONLY','CUSTOMER_AND_BUSINESS_LOCATION']),places:z.object({placeInfos:z.array(z.object({placeName:text,placeId:text}).strict()).max(20)}).strict().optional()}).strict().nullable().optional(),
  'openInfo.openingDate':date.nullable().optional(),
  'openInfo.status':z.enum(['OPEN','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY']).optional(),
}).strict();
export const ownerProfileInput=z.object({fields:profileFields.refine(f=>Object.keys(f).length>0)}).strict();
