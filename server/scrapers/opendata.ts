/** Official, metadata-verified permit datasets. See opendata.REPORT.md for provenance. */
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

type Field = string | string[];
type MappedField = Exclude<keyof PermitRecord, "jurisdiction" | "databaseId" | "raw">;
export interface Dataset {
  kind: "socrata" | "arcgis" | "ckan" | "carto";
  url: string;
  title: string;
  id: string;
  metadataUrl: string;
  portalUrls: string[];
  fields: Partial<Record<MappedField, Field>> & { permitNumber: Field; address: Field };
  dateField: string;
  orderField: string;
  table?: string;
  /** date: publish only a calendar day; replay that day for hourly polling. */
  dateType?: "timestamp" | "date";
  numericFields?: string[];
  geometryField?: string;
  scope?: string;
  contractorContacts?: { name: string; type: string }[];
}

export const DATASETS: Record<string, Dataset> = /* DATASETS_START */ {
  "New York, NY": {
    "kind": "socrata",
    "url": "https://data.cityofnewyork.us/resource/rbx6-tga4.json",
    "title": "DOB NOW: Build – Approved Permits",
    "id": "rbx6-tga4",
    "metadataUrl": "https://data.cityofnewyork.us/api/views/rbx6-tga4.json",
    "portalUrls": [
      "https://a810-dobnow.nyc.gov/publish/Index.html"
    ],
    "fields": {
      "permitNumber": "work_permit",
      "address": [
        "house_no",
        "street_name"
      ],
      "permitType": "work_type",
      "status": "permit_status",
      "issuedAt": "issued_date",
      "expiresAt": "expired_date",
      "description": "job_description",
      "valuation": "estimated_job_costs",
      "lat": "latitude",
      "lng": "longitude",
      "applicantName": [
        "applicant_first_name",
        "applicant_last_name"
      ],
      "ownerName": "owner_name"
    },
    "dateField": "issued_date",
    "orderField": ":id",
    "scope": "work_permit IS NOT NULL AND work_permit != 'Permit is not yet issued'",
    "dateType": "date"
  },
  "Los Angeles, CA": {
    "kind": "socrata",
    "url": "https://data.lacity.org/resource/pi9x-tg5x.json",
    "title": "Building and Safety - Building Permits Issued from 2020 to Present (N)",
    "id": "pi9x-tg5x",
    "metadataUrl": "https://data.lacity.org/api/views/pi9x-tg5x.json",
    "portalUrls": [
      "https://www.ladbsservices2.lacity.org/OnlineServices/"
    ],
    "fields": {
      "permitNumber": "permit_nbr",
      "address": "primary_address",
      "permitType": "permit_type",
      "workClass": "permit_sub_type",
      "status": "status_desc",
      "issuedAt": "issue_date",
      "appliedAt": "submitted_date",
      "description": "work_desc",
      "valuation": "valuation",
      "lat": "lat",
      "lng": "lon",
      "parcel": "apn"
    },
    "dateField": "issue_date",
    "orderField": ":id",
    "dateType": "date"
  },
  "Chicago, IL": {
    "kind": "socrata",
    "url": "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    "title": "Building Permits",
    "id": "ydr8-5enu",
    "metadataUrl": "https://data.cityofchicago.org/api/views/ydr8-5enu.json",
    "portalUrls": [
      "https://webapps1.chicago.gov/buildingrecords/"
    ],
    "fields": {
      "permitNumber": "permit_",
      "address": [
        "street_number",
        "street_direction",
        "street_name"
      ],
      "permitType": "permit_type",
      "status": "permit_status",
      "issuedAt": "issue_date",
      "appliedAt": "application_start_date",
      "description": "work_description",
      "valuation": "reported_cost",
      "lat": "latitude",
      "lng": "longitude"
    },
    "dateField": "issue_date",
    "orderField": ":id",
    "numericFields": [
      "street_number"
    ],
    "contractorContacts": [
      {
        "name": "contact_1_name",
        "type": "contact_1_type"
      },
      {
        "name": "contact_2_name",
        "type": "contact_2_type"
      },
      {
        "name": "contact_3_name",
        "type": "contact_3_type"
      },
      {
        "name": "contact_4_name",
        "type": "contact_4_type"
      },
      {
        "name": "contact_5_name",
        "type": "contact_5_type"
      },
      {
        "name": "contact_6_name",
        "type": "contact_6_type"
      },
      {
        "name": "contact_7_name",
        "type": "contact_7_type"
      },
      {
        "name": "contact_8_name",
        "type": "contact_8_type"
      },
      {
        "name": "contact_9_name",
        "type": "contact_9_type"
      },
      {
        "name": "contact_10_name",
        "type": "contact_10_type"
      },
      {
        "name": "contact_11_name",
        "type": "contact_11_type"
      },
      {
        "name": "contact_12_name",
        "type": "contact_12_type"
      },
      {
        "name": "contact_13_name",
        "type": "contact_13_type"
      },
      {
        "name": "contact_14_name",
        "type": "contact_14_type"
      },
      {
        "name": "contact_15_name",
        "type": "contact_15_type"
      }
    ],
    "dateType": "date"
  },
  "Austin, TX": {
    "kind": "socrata",
    "url": "https://data.austintexas.gov/resource/3syk-w9eu.json",
    "title": "Issued Construction Permits",
    "id": "3syk-w9eu",
    "metadataUrl": "https://data.austintexas.gov/api/views/3syk-w9eu.json",
    "portalUrls": [
      "https://abc.austintexas.gov/web/permit/public-search-other"
    ],
    "fields": {
      "permitNumber": "permit_number",
      "address": "original_address1",
      "permitType": "permit_type_desc",
      "status": "status_current",
      "issuedAt": "issue_date",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "total_job_valuation",
      "lat": "latitude",
      "lng": "longitude",
      "contractorName": "contractor_company_name",
      "applicantName": "applicant_full_name",
      "sourceUrl": "link",
      "parcel": "tcad_id",
      "workClass": "work_class"
    },
    "dateField": "issue_date",
    "orderField": ":id",
    "dateType": "date"
  },
  "Seattle, WA": {
    "kind": "socrata",
    "url": "https://data.seattle.gov/resource/76t5-zqzr.json",
    "title": "Building Permits",
    "id": "76t5-zqzr",
    "metadataUrl": "https://data.seattle.gov/api/views/76t5-zqzr.json",
    "portalUrls": [
      "https://services.seattle.gov/Portal/Customization/SEATTLE/welcome.aspx"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittypedesc",
      "status": "statuscurrent",
      "issuedAt": "issueddate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcost",
      "lat": "latitude",
      "lng": "longitude",
      "contractorName": "contractorcompanyname",
      "sourceUrl": "link"
    },
    "dateField": "issueddate",
    "orderField": ":id",
    "dateType": "date"
  },
  "San Francisco, CA": {
    "kind": "socrata",
    "url": "https://data.sfgov.org/resource/i98e-djp9.json",
    "title": "Building Permits",
    "id": "i98e-djp9",
    "metadataUrl": "https://data.sfgov.org/api/views/i98e-djp9.json",
    "portalUrls": [
      "https://sanfranciscoca.portal.opengov.com/"
    ],
    "fields": {
      "permitNumber": "permit_number",
      "address": [
        "street_number",
        "street_name",
        "street_suffix"
      ],
      "permitType": "permit_type_definition",
      "status": "status",
      "issuedAt": "issued_date",
      "appliedAt": "filed_date",
      "description": "description",
      "valuation": "estimated_cost"
    },
    "dateField": "issued_date",
    "orderField": ":id",
    "geometryField": "location"
  },
  "Las Vegas, NV": {
    "kind": "arcgis",
    "url": "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/OpenData_Building_Permits_/FeatureServer/0",
    "title": "Building Permits ",
    "id": "9f2697a560194be6bc14963405b72656",
    "metadataUrl": "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/OpenData_Building_Permits_/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "APNO",
      "address": [
        "STNO",
        "PREDIR",
        "STNAME",
        "SUFFIX",
        "POSTDIR"
      ],
      "permitType": "APTYPE",
      "status": "BLDGAPPLSTATUS",
      "issuedAt": "ISSDTTM",
      "valuation": "DECLVLTN",
      "description": "WORKTYPE",
      "applicantName": "APPLICANT",
      "ownerName": "LEGALOWNER",
      "parcel": "PRCLID"
    },
    "dateField": "ISSDTTM",
    "orderField": "ObjectId",
    "numericFields": [
      "STNO"
    ]
  },
  "Miami-Dade County, FL": {
    "kind": "arcgis",
    "url": "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0",
    "title": "Building Permits Issued By Miami-Dade County - 2 Previous Years to Present",
    "id": "6db5f56e886446df88313ca279e59120",
    "metadataUrl": "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0?f=json",
    "portalUrls": [
      "https://www.miamidade.gov/Apps/RER/EPSPortal"
    ],
    "fields": {
      "permitNumber": "PermitNumber",
      "address": "PropertyAddress",
      "permitType": "PermitType",
      "issuedAt": "PermitIssuedDate",
      "appliedAt": "ApplicationDate",
      "valuation": "EstimatedValue",
      "description": "DetailDescriptionComments",
      "contractorName": "ContractorName",
      "contractorLicense": "ContractorNumber",
      "ownerName": "OwnerName",
      "parcel": "FolioNumber"
    },
    "dateField": "PermitIssuedDate",
    "orderField": "ObjectId",
    "dateType": "date"
  },
  "Columbus, OH": {
    "kind": "arcgis",
    "url": "https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0",
    "title": "Building Permits",
    "id": "f7a785b863454d96a0fe3f5aa5368e7d",
    "metadataUrl": "https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json",
    "portalUrls": [
      "https://portal.columbus.gov/Permits/Default.aspx"
    ],
    "fields": {
      "permitNumber": "B1_ALT_ID",
      "address": "SITE_ADDRESS",
      "permitType": "B1_PER_TYPE",
      "status": "PERMIT_STATUS",
      "issuedAt": "ISSUED_DT",
      "valuation": "G3_VALUE_TTL",
      "applicantName": "APPLICANT_FULL_NAME",
      "sourceUrl": "ACA_URL",
      "parcel": "B1_PARCEL_NBR"
    },
    "dateField": "ISSUED_DT",
    "orderField": "OBJECTID"
  },
  "Detroit, MI": {
    "kind": "arcgis",
    "url": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0",
    "title": "Building Permits",
    "id": "86d47e86062e4beeb19344eb125b75d2",
    "metadataUrl": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0?f=json",
    "portalUrls": [
      "https://aca-prod.accela.com/DETROIT/Default.aspx"
    ],
    "fields": {
      "permitNumber": "record_id",
      "address": "address",
      "permitType": "permit_type",
      "issuedAt": "issued_date",
      "appliedAt": "submitted_date",
      "valuation": "amt_estimated_contractor_cost",
      "description": "work_description",
      "lat": "latitude",
      "lng": "longitude",
      "parcel": "parcel_id"
    },
    "dateField": "issued_date",
    "orderField": "ObjectId",
    "dateType": "date"
  },
  "Minneapolis, MN": {
    "kind": "arcgis",
    "url": "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0",
    "title": "CCS_Permits",
    "id": "df4bfccbe60b42a6a93fb7bc1fd84cc0",
    "metadataUrl": "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0?f=json",
    "portalUrls": [
      "https://www.minneapolismn.gov/business-services/licenses-permits-inspections/construction-permits/"
    ],
    "fields": {
      "permitNumber": "permitNumber",
      "address": "Display",
      "permitType": "permitType",
      "status": "status",
      "issuedAt": "issueDate",
      "valuation": "permit_Value",
      "description": "comments",
      "applicantName": "applicantName",
      "lat": "Latitude",
      "lng": "Longitude",
      "parcel": "APN"
    },
    "dateField": "issueDate",
    "orderField": "OBJECTID"
  },
  "Maricopa County, AZ": {
    "kind": "arcgis",
    "url": "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0",
    "title": "Building Permits",
    "id": "86909eb1ea9149308abaadba377f388f",
    "metadataUrl": "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0?f=json",
    "portalUrls": [
      "https://maricopacountyaz-energovweb.tylerhost.net/apps/selfservice#/home"
    ],
    "fields": {
      "permitNumber": "PermitNumber",
      "address": "FullStreetAddress",
      "permitType": "PermitType",
      "status": "PermitStatus",
      "issuedAt": "IssuedDate",
      "appliedAt": "ApplicationDate",
      "expiresAt": "ExpirationDate",
      "description": "PermitDescription",
      "parcel": "APNDash",
      "workClass": "WorkClass"
    },
    "dateField": "IssuedDate",
    "orderField": "OBJECTID"
  },
  "Los Angeles County, CA": {
    "kind": "arcgis",
    "url": "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0",
    "title": "LA County Permitting (EPIC-LA Case History)",
    "id": "b2a835d49c194029a525fb60cf24aa59",
    "metadataUrl": "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "CASENUMBER",
      "address": "MAIN_ADDRESS",
      "permitType": "CASENAME",
      "status": "STATUS",
      "issuedAt": "ISSUANCE_DATE",
      "appliedAt": "APPLY_DATE",
      "expiresAt": "EXPIRE_DATE",
      "description": "DESCRIPTION",
      "valuation": "PERMIT_VALUATION",
      "parcel": "MAIN_AIN",
      "workClass": "WORKCLASS_NAME"
    },
    "dateField": "ISSUANCE_DATE",
    "orderField": "OBJECTID",
    "scope": "MODULENAME = 'PermitManagement'"
  },
  "Mecklenburg County, NC": {
    "kind": "arcgis",
    "url": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0",
    "title": "Building Permit Locations",
    "id": "fc9d171ecd4d44a58c7dad840cd58aa2",
    "metadataUrl": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0?f=json",
    "portalUrls": [
      "https://aca-prod.accela.com/MECKLENBURG/Default.aspx"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "projadd",
      "permitType": "permittype",
      "status": "permitstat",
      "issuedAt": "issuedate",
      "description": "workdesc",
      "valuation": "bldgcost",
      "ownerName": "ownname",
      "parcel": "parcelnum",
      "workClass": "worktype"
    },
    "dateField": "issuedate",
    "orderField": "objectid"
  },
  "Portland, OR": {
    "kind": "arcgis",
    "url": "https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/89",
    "title": "Residential Building Permits",
    "id": "02d99db039e0428da88262bff513056a",
    "metadataUrl": "https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/89?f=json",
    "portalUrls": [
      "https://www.portland.gov/permits"
    ],
    "fields": {
      "permitNumber": "FOLDERNUMB",
      "address": "PROP_ADDRE",
      "permitType": "NEWTYPE",
      "status": "STATUS",
      "issuedAt": "ISSUEDATE",
      "appliedAt": "INDATE",
      "description": "WORKDESC",
      "valuation": "VALUATION",
      "parcel": "PROPGISID1",
      "workClass": "NEWCLASS"
    },
    "dateField": "ISSUEDATE",
    "orderField": "OBJECTID"
  },
  "Cincinnati, OH": {
    "kind": "socrata",
    "url": "https://data.cincinnati-oh.gov/resource/uhjb-xac9.json",
    "title": "Cincinnati Building Permits",
    "id": "uhjb-xac9",
    "metadataUrl": "https://data.cincinnati-oh.gov/api/views/uhjb-xac9.json",
    "portalUrls": [
      "https://aca-prod.accela.com/CINCINNATI/Default.aspx"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittype",
      "status": "statuscurrent",
      "issuedAt": "issueddate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcostdec",
      "contractorName": "companyname",
      "lat": "latitude",
      "lng": "longitude",
      "sourceUrl": "link"
    },
    "dateField": "issueddate",
    "orderField": ":id",
    "dateType": "date"
  },
  "Mesa, AZ": {
    "kind": "socrata",
    "url": "https://data.mesaaz.gov/resource/dzpk-hxfb.json",
    "title": "Building Permits",
    "id": "dzpk-hxfb",
    "metadataUrl": "https://data.mesaaz.gov/api/views/dzpk-hxfb.json",
    "portalUrls": [
      "https://aca-prod.accela.com/MESA/Default.aspx"
    ],
    "fields": {
      "permitNumber": "permit_number",
      "address": "property_address",
      "permitType": "permit_type",
      "status": "status",
      "issuedAt": "issued_date",
      "description": "description_of_work",
      "valuation": "total_valuation",
      "contractorName": "contractor_name",
      "contractorLicense": "contractor_license",
      "applicantName": "applicant",
      "lat": "latitude",
      "lng": "longitude",
      "parcel": "parcel_number"
    },
    "dateField": "issued_date",
    "orderField": ":id",
    "dateType": "date"
  },
  "Philadelphia, PA": {
    "kind": "carto",
    "url": "https://phl.carto.com/api/v2/sql",
    "title": "Licenses and Inspections Building and Zoning Permits",
    "id": "permits",
    "metadataUrl": "https://phl.carto.com/api/v2/sql?q=SELECT%20*%20FROM%20permits%20LIMIT%200",
    "portalUrls": [
      "https://eclipse.phila.gov/phillylmsprod/pub/lms/Login.aspx"
    ],
    "fields": {
      "permitNumber": "permitnumber",
      "address": "address",
      "permitType": "permittype",
      "status": "status",
      "issuedAt": "permitissuedate",
      "description": "approvedscopeofwork",
      "contractorName": "contractorname",
      "ownerName": "opa_owner",
      "parcel": "parcel_id_num",
      "workClass": "typeofwork"
    },
    "dateField": "permitissuedate",
    "orderField": "cartodb_id",
    "table": "permits"
  },
  "Nashville, TN": {
    "kind": "arcgis",
    "url": "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0",
    "title": "Building Permits Issued",
    "id": "2576bfb2d74f418b8ba8c4538e4f729f",
    "metadataUrl": "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0?f=json",
    "portalUrls": [
      "https://epermits.nashville.gov/"
    ],
    "fields": {
      "permitNumber": "Permit__",
      "address": "Address",
      "permitType": "Permit_Type_Description",
      "issuedAt": "Date_Issued",
      "appliedAt": "Date_Entered",
      "description": "Purpose",
      "valuation": "Const_Cost",
      "lat": "Lat",
      "lng": "Lon",
      "parcel": "Parcel"
    },
    "dateField": "Date_Issued",
    "orderField": "ObjectId"
  },
  "Fort Worth, TX": {
    "kind": "arcgis",
    "url": "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0",
    "title": "CFW Development Permits Table",
    "id": "d2740f4d746b4bfaa03e25de0376238b",
    "metadataUrl": "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0?f=json",
    "portalUrls": [
      "https://aca-prod.accela.com/CFW/Default.aspx"
    ],
    "fields": {
      "permitNumber": "Permit_No",
      "address": [
        "Addr_No",
        "Direction",
        "Street_Name",
        "Street_Suffix",
        "Street_Suffix_Dir"
      ],
      "permitType": "Permit_Type",
      "status": "Current_Status",
      "appliedAt": "File_Date",
      "description": "B1_WORK_DESC",
      "valuation": "JobValue",
      "ownerName": "Owner_Full_Name",
      "workClass": "Permit_SubType"
    },
    "dateField": "File_Date",
    "orderField": "ObjectId",
    "numericFields": [
      "Addr_No"
    ]
  },
  "Wake County, NC": {
    "kind": "arcgis",
    "url": "https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0",
    "title": "Building Permits",
    "id": "6a9651b339b7413d8dc264f9ae1b3f6f",
    "metadataUrl": "https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0?f=json",
    "portalUrls": [
      "https://wakecountync-energovpub.tylerhost.net/apps/SelfService#/home"
    ],
    "fields": {
      "permitNumber": "PERMIT_NUMBER",
      "address": "MAILING_ADDRESS",
      "permitType": "PERMIT_TYPE",
      "status": "PERMIT_STATUS",
      "issuedAt": "ISSUE_DATE",
      "appliedAt": "APPLICATION_DATE",
      "expiresAt": "EXPIRATION_DATE",
      "description": "DESCRIPTION",
      "valuation": "VALUATION",
      "contractorName": "CONTRACTOR",
      "sourceUrl": "LINK",
      "parcel": "PIN",
      "workClass": "WORK_CLASS"
    },
    "dateField": "ISSUE_DATE",
    "orderField": "OBJECTID"
  },
  "Pierce County, WA": {
    "kind": "arcgis",
    "url": "https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Permits_Pierce_County/FeatureServer/0",
    "title": "Permits_Pierce_County",
    "id": "7a2af86e0b64463b9caeb08c374a24ac",
    "metadataUrl": "https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Permits_Pierce_County/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "applicationNumber",
      "address": "siteAddress",
      "permitType": "applicationType",
      "status": "applicationStatus",
      "issuedAt": "issuedDate",
      "appliedAt": "applicationDate",
      "description": "workDescription",
      "valuation": "projectValue",
      "sourceUrl": "urlOnlinePermits",
      "parcel": "parcelNumber",
      "workClass": "workType"
    },
    "dateField": "issuedDate",
    "orderField": "OBJECTID",
    "numericFields": [
      "applicationNumber"
    ]
  },
  "Raleigh, NC": {
    "kind": "arcgis",
    "url": "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0",
    "title": "Building Permits",
    "id": "bdfad82b15344d37beb28d7f90b6c4be",
    "metadataUrl": "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json",
    "portalUrls": [
      "https://raleighnc.gov/permits"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittype",
      "status": "statuscurrent",
      "issuedAt": "issueddate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcost",
      "contractorName": "contractorcompanyname",
      "contractorLicense": "contractorlicnum",
      "lat": "latitude_perm",
      "lng": "longitude_perm",
      "parcel": "pin",
      "ownerName": "parcelownername"
    },
    "dateField": "issueddate",
    "orderField": "OBJECTID"
  },
  "Tucson, AZ": {
    "kind": "arcgis",
    "url": "https://gis.tucsonaz.gov/public/rest/services/PublicMaps/PermitsCode/MapServer/85",
    "title": "Residential Permits",
    "id": "d8132cd24a47442aa2ed35180b78cb51",
    "metadataUrl": "https://gis.tucsonaz.gov/public/rest/services/PublicMaps/PermitsCode/MapServer/85?f=json",
    "portalUrls": [
      "https://cityoftucsonaz-energovweb.tylerhost.net/apps/selfservice#/home"
    ],
    "fields": {
      "permitNumber": "NUMBER",
      "address": "ADDRESS",
      "permitType": "TYPE",
      "status": "STATUS",
      "issuedAt": "ISSUEDATE",
      "appliedAt": "APPLYDATE",
      "expiresAt": "EXPIREDATE",
      "description": "DESCRIPTION",
      "valuation": "VALUE",
      "lat": "LAT",
      "lng": "LON",
      "parcel": "PARCEL",
      "sourceUrl": "CSS_URL"
    },
    "dateField": "ISSUEDATE",
    "orderField": "OBJECTID"
  },
  "Virginia Beach, VA": {
    "kind": "arcgis",
    "url": "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0",
    "title": "Permits",
    "id": "f40c03f52cfb4a068851fe9f2e62c44b",
    "metadataUrl": "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "Building_Permits_PermitNumber",
      "address": "Building_Permits_StreetAddress",
      "permitType": "Building_Permits_PermitType",
      "status": "Building_Permits_Status",
      "issuedAt": "Building_Permits_IssueDate",
      "appliedAt": "Building_Permits_ApplicationDat",
      "description": "Building_Permits_WorkDesc",
      "parcel": "Building_Permits_GPIN_Text"
    },
    "dateField": "Building_Permits_IssueDate",
    "orderField": "OBJECTID",
    "dateType": "date"
  },
  "Baltimore County, MD": {
    "kind": "arcgis",
    "url": "https://bcgis.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/0",
    "title": "Active Permits (Baltimore County, MD)",
    "id": "a241ce53514c4f48a04e6c58f186307e",
    "metadataUrl": "https://bcgis.baltimorecountymd.gov/arcgis/rest/services/DevelopmentManagement/ActiveDevelopment/MapServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "PERMITNO",
      "address": "P_ADDRESS",
      "permitType": "PERMIT_TYPE",
      "status": "STATUS",
      "issuedAt": "ISSDATE",
      "appliedAt": "APPL_DATE",
      "description": "DESC_WORK",
      "valuation": "EST_COST",
      "ownerName": "OWNER_NAME",
      "parcel": "PARCEL"
    },
    "dateField": "APPL_DATE",
    "orderField": "OBJECTID"
  },
  "Montgomery County, MD": {
    "kind": "socrata",
    "url": "https://data.montgomerycountymd.gov/resource/m88u-pqki.json",
    "title": "Residential Permit",
    "id": "m88u-pqki",
    "metadataUrl": "https://data.montgomerycountymd.gov/api/views/m88u-pqki.json",
    "portalUrls": [
      "https://permittingservices.montgomerycountymd.gov/DPS/online/eSearch.aspx"
    ],
    "fields": {
      "permitNumber": "permitno",
      "address": [
        "stno",
        "predir",
        "stname",
        "suffix",
        "postdir"
      ],
      "permitType": "applicationtype",
      "status": "status",
      "issuedAt": "issueddate",
      "appliedAt": "addeddate",
      "description": "description",
      "valuation": "declaredvaluation",
      "workClass": "worktype"
    },
    "dateField": "issueddate",
    "orderField": ":id",
    "geometryField": "location"
  },
  "Honolulu, HI": {
    "kind": "socrata",
    "url": "https://data.honolulu.gov/resource/4vab-c87q.json",
    "title": "Building Permits - January 1, 2005 through June 30, 2025",
    "id": "4vab-c87q",
    "metadataUrl": "https://data.honolulu.gov/api/views/4vab-c87q.json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "buildingpermitno",
      "address": "joblocation",
      "permitType": "buildingpermittype",
      "status": "statusdescription",
      "issuedAt": "issuedate",
      "appliedAt": "createddate",
      "valuation": "estimatedvalueofwork",
      "contractorName": "contractor",
      "applicantName": "applicant",
      "parcel": "tmk"
    },
    "dateField": "issuedate",
    "orderField": ":id",
    "numericFields": [
      "buildingpermitno"
    ],
    "scope": "buildingpermitno IS NOT NULL",
    "dateType": "date"
  },
  "New Orleans, LA": {
    "kind": "socrata",
    "url": "https://data.nola.gov/resource/72f9-bi28.json",
    "title": "Permits - BLDS",
    "id": "72f9-bi28",
    "metadataUrl": "https://data.nola.gov/api/views/72f9-bi28.json",
    "portalUrls": [
      "https://onestopapp.nola.gov/"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittype",
      "workClass": "workclass",
      "status": "statuscurrent",
      "issuedAt": "issuedate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcost",
      "contractorName": "contractorcompanyname",
      "contractorLicense": "contractorlicnum",
      "parcel": "pin",
      "sourceUrl": "link"
    },
    "dateField": "issuedate",
    "orderField": ":id",
    "geometryField": "location"
  },
  "Boston, MA": {
    "kind": "ckan",
    "url": "https://data.boston.gov/api/3/action/datastore_search_sql",
    "title": "Approved Building Permits",
    "id": "6ddcd912-32a0-43df-9908-63574f8c7e77",
    "metadataUrl": "https://data.boston.gov/api/3/action/package_show?id=approved-building-permits",
    "portalUrls": [],
    "fields": {
      "permitNumber": "permitnumber",
      "address": "address",
      "permitType": "permittypedescr",
      "status": "status",
      "issuedAt": "issued_date",
      "expiresAt": "expiration_date",
      "description": "comments",
      "valuation": "declared_valuation",
      "applicantName": "applicant",
      "lat": "y_latitude",
      "lng": "x_longitude",
      "parcel": "parcel_id",
      "workClass": "worktype"
    },
    "dateField": "issued_date",
    "orderField": "_id"
  },
  "Washington, DC": {
    "kind": "arcgis",
    "url": "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18",
    "title": "Building Permits in 2026",
    "id": "7296e6392349498bb6ba6ba3db836644",
    "metadataUrl": "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18?f=json",
    "portalUrls": [
      "https://citizenaccess.dc.gov/"
    ],
    "fields": {
      "permitNumber": "PERMIT_ID",
      "address": "FULL_ADDRESS",
      "permitType": "PERMIT_TYPE_NAME",
      "status": "APPLICATION_STATUS_NAME",
      "issuedAt": "ISSUE_DATE",
      "description": "DESC_OF_WORK",
      "applicantName": "PERMIT_APPLICANT",
      "ownerName": "OWNER_NAME",
      "lat": "LATITUDE",
      "lng": "LONGITUDE",
      "parcel": "SSL"
    },
    "dateField": "ISSUE_DATE",
    "orderField": "OBJECTID"
  },
  "Baltimore, MD": {
    "kind": "arcgis",
    "url": "https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3",
    "title": "Housing and Building Permits 2019-Present",
    "id": "189e6d1c65df4e13b38c0027cee574f6",
    "metadataUrl": "https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3?f=json",
    "portalUrls": [
      "https://aca-prod.accela.com/BALTIMORE/Default.aspx"
    ],
    "fields": {
      "permitNumber": "CaseNumber",
      "address": "Address",
      "permitType": "PermitName",
      "issuedAt": "IssuedDate",
      "expiresAt": "ExpirationDate",
      "description": "Description",
      "valuation": "Cost",
      "parcel": "BLOCKLOT"
    },
    "dateField": "IssuedDate",
    "orderField": "OBJECTID"
  },
  "Louisville, KY": {
    "kind": "arcgis",
    "url": "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0",
    "title": "Louisville Metro KY - Active Construction Permits",
    "id": "0251a88cefdc4ab3a0d85943074e6d7b",
    "metadataUrl": "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "PERMIT_NUMBER",
      "address": "ADDRESS",
      "permitType": "PERMIT_TYPE",
      "status": "PERMIT_STATUS",
      "issuedAt": "ISSUE_DATE",
      "valuation": "PROJECT_COSTS",
      "contractorName": "CONTRACTOR",
      "lat": "LATITUDE",
      "lng": "LONGITUDE",
      "workClass": "WORK_TYPE"
    },
    "dateField": "ISSUE_DATE",
    "orderField": "ObjectId"
  },
  "San Jose, CA": {
    "kind": "arcgis",
    "url": "https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/7",
    "title": "Recent Building Permit (30 Days)",
    "id": "ff98b7202b6f4c02a66b7c2634d07416/7",
    "metadataUrl": "https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/7?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "FOLDERNUM",
      "address": "ADDRESS",
      "issuedAt": "ISSUEDATEUTC",
      "description": "WORKDESC",
      "valuation": "PERMITVALUE",
      "contractorName": "CONTRACTOR",
      "applicantName": "APPLICANT",
      "parcel": "APN"
    },
    "dateField": "ISSUEDATEUTC",
    "orderField": "OBJECTID"
  },
  "Harris County, TX": {
    "kind": "arcgis",
    "url": "https://www.gis.hctx.net/arcgishcpid/rest/services/Permits/AiPermitsService/FeatureServer/1",
    "title": "Permits",
    "id": "AiPermitsService/1",
    "metadataUrl": "https://www.gis.hctx.net/arcgishcpid/rest/services/Permits/AiPermitsService/FeatureServer/1?f=json",
    "portalUrls": [
      "https://epermits.harriscountytx.gov/PublicProjectStatus.aspx"
    ],
    "fields": {
      "permitNumber": "PERMITNUMBER",
      "address": "FULLADDRESS",
      "permitType": "PERMITNAME",
      "status": "STATUS",
      "issuedAt": "ISSUEDDATE",
      "description": "PROJECTNAME"
    },
    "dateField": "ISSUEDDATE",
    "orderField": "OBJECTID"
  },
  "Charlotte, NC": {
    "kind": "arcgis",
    "url": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0",
    "title": "Building Permit Locations",
    "id": "fc9d171ecd4d44a58c7dad840cd58aa2",
    "metadataUrl": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "permitnum",
      "address": "projadd",
      "permitType": "permittype",
      "status": "permitstat",
      "issuedAt": "issuedate",
      "description": "workdesc",
      "valuation": "bldgcost",
      "ownerName": "ownname",
      "parcel": "parcelnum",
      "workClass": "worktype"
    },
    "dateField": "issuedate",
    "orderField": "objectid",
    "scope": "taxjuris = 'CHARLOTTE'"
  },
  "Kansas City, MO": {
    "kind": "socrata",
    "url": "https://data.kcmo.org/resource/ntw8-aacc.json",
    "title": "Permits - CPD Dataset",
    "id": "ntw8-aacc",
    "metadataUrl": "https://data.kcmo.org/api/views/ntw8-aacc.json",
    "portalUrls": [
      "https://compasskc.kcmo.org/EnerGov_Prod/SelfService#/home"
    ],
    "fields": {
      "permitNumber": "permitnum",
      "address": "originaladdress1",
      "permitType": "permittypedesc",
      "status": "statuscurrent",
      "issuedAt": "issueddate",
      "appliedAt": "applieddate",
      "expiresAt": "expiresdate",
      "description": "description",
      "valuation": "estprojectcost",
      "contractorName": "contractorcompanyname",
      "contractorLicense": "contractorlicnum",
      "lat": "latitude",
      "lng": "longitude",
      "sourceUrl": "link",
      "parcel": "pin"
    },
    "dateField": "issueddate",
    "orderField": ":id",
    "dateType": "date"
  },
  "San Antonio, TX": {
    "kind": "ckan",
    "url": "https://data.sanantonio.gov/api/3/action/datastore_search_sql",
    "title": "Building Permits - PERMITS ISSUED",
    "id": "c21106f9-3ef5-4f3a-8604-f992b4db7512",
    "metadataUrl": "https://data.sanantonio.gov/api/3/action/package_show?id=building-permits",
    "portalUrls": [
      "https://aca-prod.accela.com/COSA/Default.aspx"
    ],
    "fields": {
      "permitNumber": "PERMIT #",
      "address": "ADDRESS",
      "permitType": "PERMIT TYPE",
      "issuedAt": "DATE ISSUED",
      "appliedAt": "DATE SUBMITTED",
      "description": "PROJECT NAME",
      "valuation": "DECLARED VALUATION",
      "workClass": "WORK TYPE"
    },
    "dateField": "DATE ISSUED",
    "dateType": "date",
    "orderField": "_id",
    "scope": "\"PERMIT TYPE\" != 'Garage Sale'"
  },
  "San Diego, CA": {
    "kind": "arcgis",
    "url": "https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/0",
    "title": "Permit Approvals (Accela)",
    "id": "9e20b434e8424f3eb248a0088f21a208/0",
    "metadataUrl": "https://webmaps.sandiego.gov/arcgis/rest/services/DoIT_Public/DSDPermits/MapServer/0?f=json",
    "portalUrls": [
      "https://aca-prod.accela.com/SANDIEGO/Default.aspx"
    ],
    "fields": {
      "permitNumber": "APPROVAL_ID",
      "address": "GIS_ADDRESS",
      "permitType": "APPROVAL_TYPE",
      "status": "APPROVAL_STATUS",
      "issuedAt": "APPROVAL_ISSUE_DATE",
      "appliedAt": "APPROVAL_CREATE_DATE",
      "expiresAt": "APPROVAL_EXPIRE_DATE",
      "description": "APPROVAL_SCOPE",
      "lat": "GIS_LATITUDE",
      "lng": "GIS_LONGITUDE",
      "parcel": "GIS_APN",
      "sourceUrl": "APPROVAL_URL"
    },
    "dateField": "APPROVAL_ISSUE_DATE",
    "orderField": "OBJECTID",
    "scope": "APPROVAL_ID LIKE 'PMT-%'"
  },
  "Denver, CO": {
    "kind": "arcgis",
    "url": "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316",
    "title": "Residential Construction Permits",
    "id": "014a873bf7444a658fc2ea0da7ad0704",
    "metadataUrl": "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316?f=json",
    "portalUrls": [],
    "fields": {
      "permitNumber": "PERMIT_NUM",
      "address": "ADDRESS",
      "permitType": "CLASS",
      "issuedAt": "DATE_ISSUED",
      "appliedAt": "DATE_RECEIVED",
      "valuation": "VALUATION",
      "contractorName": "CONTRACTOR_NAME",
      "parcel": "SCHEDNUM"
    },
    "dateField": "DATE_ISSUED",
    "orderField": "OBJECTID"
  }
} /* DATASETS_END */;
export const OPENDATA_JURISDICTIONS: string[] = Object.keys(DATASETS);

function canonical(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Unsupported portal protocol");
  return u.href.replace(/\/$/, "");
}
export function datasetFor(ctx: AdapterCtx): Dataset {
  const d = DATASETS[ctx.jurisdiction];
  if (!d) throw new Error(`No verified open-data dataset for ${ctx.jurisdiction}`);
  const input = canonical(ctx.searchUrl);
  if (![d.url, d.metadataUrl, ...d.portalUrls].some(u => canonical(u) === input)) {
    throw new Error(`URL is not a verified open-data source/catalog portal for ${ctx.jurisdiction}`);
  }
  return d;
}
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
function identifier(s: string, d: Dataset): string {
  if (d.kind === "ckan" || d.kind === "carto") return `"${s.replace(/"/g, '""')}"`;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !(d.kind === "socrata" && s === ":id")) throw new Error(`Unsafe dataset field ${s}`);
  return s;
}
const parts = (field: Field | undefined): string[] => field ? Array.isArray(field) ? field : [field] : [];
function expression(field: Field, d: Dataset): string {
  const fs = parts(field).map(f => {
    const id = identifier(f, d);
    if (d.kind === "socrata" && d.numericFields?.includes(f)) return `${id}::text`;
    return id;
  });
  if (fs.length === 1) return fs[0];
  if (d.kind === "socrata") return fs.map(f => `coalesce(${f}, '')`).join(" || ' ' || ");
  return fs.map(f => `COALESCE(CAST(${f} AS VARCHAR), '')`).join(" || ' ' || ");
}
export function searchWhere(d: Dataset, q: { type: PermitSearchType; value: string }): string {
  if (!["address", "permit", "name", "company", "license", "keyword"].includes(q.type)) throw new Error("Unsupported search type");
  const value = q.value.trim();
  if (!value || value.length > 300) throw new Error("Search value must contain 1–300 characters");
  // Do not let LIKE metacharacters turn an address search into a full-table scan.
  if (/[%_\\]/.test(value) && q.type !== "permit") throw new Error("Search wildcards are unsupported");
  const fields: (Field | undefined)[] = q.type === "address" ? [d.fields.address]
    : q.type === "permit" ? [d.fields.permitNumber]
    : q.type === "company" ? [d.fields.contractorName]
    : q.type === "name" ? [d.fields.applicantName, d.fields.ownerName, d.fields.contractorName]
    : q.type === "license" ? [d.fields.contractorLicense]
    : [d.fields.description, d.fields.permitType, d.fields.address];
  const available = fields.filter((f): f is Field => !!f);
  const contactClauses = (q.type === "company" || q.type === "name") ? (d.contractorContacts ?? []).map(c =>
    `(upper(${identifier(c.type, d)}) LIKE 'CONTRACTOR%' AND upper(${identifier(c.name, d)}) LIKE ${literal(`%${value.toUpperCase()}%`)})`) : [];
  if (!available.length && !contactClauses.length) throw new Error(`${q.type} search is not published by this dataset`);
  const contains = (field: Field, token: string): string => {
    if (d.kind === "arcgis" && Array.isArray(field)) {
      return "(" + field.map(f => {
        if (d.numericFields?.includes(f)) return /^\d+$/.test(token) ? `${identifier(f, d)} = ${Number(token)}` : "1=0";
        return `upper(${identifier(f, d)}) LIKE ${literal(`%${token.toUpperCase()}%`)}`;
      }).join(" OR ") + ")";
    }
    return `upper(${expression(field, d)}) LIKE ${literal(`%${token.toUpperCase()}%`)}`;
  };
  return "(" + available.map(f => q.type === "permit"
    ? `${expression(f, d)} = ${literal(value)}`
    : "(" + (q.type === "address" && Array.isArray(f) ? value.split(/\s+/) : [value]).map(v => contains(f, v)).join(" AND ") + ")").concat(contactClauses).join(" OR ") + ")";
}
export function recentWhere(d: Dataset, since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(since) || !Number.isFinite(Date.parse(since))) throw new Error("Invalid ISO since date");
  const calendarDay = new Date(`${since.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== since.slice(0, 10)) throw new Error("Invalid ISO since date");
  const iso = new Date(since).toISOString();
  const value = d.kind === "arcgis" ? d.dateType === "date" ? `DATE ${literal(iso.slice(0, 10))}` : `TIMESTAMP ${literal(iso.slice(0, 19).replace("T", " "))}`
    : literal(d.dateType === "date" ? iso.slice(0, 10) : d.kind === "socrata" && d.dateType !== "timestamp" ? iso.slice(0, 23) : iso);
  return `${identifier(d.dateField, d)} >= ${value}`;
}
export const PAGE_SIZE = 1000;
export function buildQuery(d: Dataset, where: string, offset = 0, limit = PAGE_SIZE): string {
  const u = new URL(d.url);
  const permitField = parts(d.fields.permitNumber)[0];
  const valid = `${identifier(permitField, d)} IS NOT NULL` + (d.kind === "arcgis" || d.numericFields?.includes(permitField) ? "" : ` AND ${identifier(permitField, d)} != ''`);
  const condition = `(${valid}) AND ` + (d.scope ? `(${d.scope}) AND (${where})` : `(${where})`);
  if (d.kind === "socrata") {
    u.searchParams.set("$where", condition); u.searchParams.set("$limit", String(limit));
    u.searchParams.set("$offset", String(offset)); u.searchParams.set("$order", identifier(d.orderField, d));
  } else if (d.kind === "arcgis") {
    u.pathname = u.pathname.replace(/\/$/, "") + "/query";
    Object.entries({ f: "json", where: condition, outFields: "*", returnGeometry: "true", outSR: "4326", resultOffset: String(offset), resultRecordCount: String(limit), orderByFields: d.orderField }).forEach(([k,v]) => u.searchParams.set(k,v));
  } else {
    const table = d.kind === "ckan" ? `"${d.id.replace(/"/g, '""')}"` : identifier(d.table!, d);
    u.searchParams.set(d.kind === "ckan" ? "sql" : "q", `SELECT * FROM ${table} WHERE ${condition} ORDER BY ${identifier(d.orderField, d)} LIMIT ${limit} OFFSET ${offset}`);
  }
  return u.href;
}
function textValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim(); return !s || /^(null|n\/a|none|needs contact)$/i.test(s) ? null : s;
}
function numberValue(value: unknown): number | null {
  const s = textValue(value); if (s === null) return null;
  const n = Number(s.replace(/[$,]/g, "")); return Number.isFinite(n) ? n : null;
}
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = textValue(value);
  if (typeof value === "number") return Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isFinite(Date.parse(s)) ? s : null;
  const n = Date.parse(s);
  if (!Number.isFinite(n)) return null;
  // Socrata floating timestamps have no timezone. Do not invent a UTC offset.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
    return /T00:00:00(?:\.0+)?$/.test(s) ? s.slice(0, 10) : s;
  }
  return new Date(n).toISOString();
}
export function parseRow(d: Dataset, raw: Record<string, unknown>, ctx: Pick<AdapterCtx, "jurisdiction" | "databaseId">): PermitRecord {
  const row = d.kind === "arcgis" ? raw.attributes as Record<string, unknown> : raw;
  if (!row || typeof row !== "object") throw new Error("Malformed permit row");
  const read = (name: MappedField): unknown => {
    const f = d.fields[name];
    return Array.isArray(f) ? f.map(k => textValue(row[k])).filter(Boolean).join(" ") || null : f ? row[f] : null;
  };
  const permitNumber = textValue(read("permitNumber"));
  if (!permitNumber) throw new Error("Dataset row has no permit number; refusing silent data loss");
  const out: PermitRecord = { permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId, raw };
  for (const k of ["address", "parcel", "permitType", "workClass", "description", "status", "contractorName", "contractorLicense", "applicantName", "ownerName"] as const) out[k] = textValue(read(k));
  if (d.contractorContacts) {
    const names = d.contractorContacts.filter(c => /^CONTRACTOR/i.test(textValue(row[c.type]) ?? "")).map(c => textValue(row[c.name])).filter((s): s is string => s !== null);
    out.contractorName = [...new Set(names)].join("; ") || null;
  }
  for (const k of ["issuedAt", "appliedAt", "expiresAt"] as const) out[k] = isoDate(read(k));
  for (const k of ["valuation", "lat", "lng"] as const) out[k] = numberValue(read(k));
  const geom = (d.kind === "arcgis" ? raw.geometry : d.geometryField ? row[d.geometryField] : null) as { x?: number; y?: number; coordinates?: number[]; latitude?: string; longitude?: string } | null;
  out.lat ??= numberValue(geom?.y ?? geom?.coordinates?.[1] ?? geom?.latitude);
  out.lng ??= numberValue(geom?.x ?? geom?.coordinates?.[0] ?? geom?.longitude);
  if (out.lat !== null && Math.abs(out.lat!) > 90) out.lat = null;
  if (out.lng !== null && Math.abs(out.lng!) > 180) out.lng = null;
  if (d.id === "4vab-c87q" && /^NONE(?:\s|$)/i.test(out.contractorName ?? "")) out.contractorName = null;
  const source = read("sourceUrl");
  const url = typeof source === "object" && source ? textValue((source as { url?: unknown }).url) : textValue(source);
  out.sourceUrl = url && /^https?:\/\//i.test(url) ? url : null;
  return out;
}
export function responseRows(d: Dataset, payload: unknown): { rows: Record<string, unknown>[]; more?: boolean } {
  const p = payload as any;
  if (p?.error || p?.success === false) {
    const code = Number(p.error?.code);
    if ([401,403,429,498,499].includes(code)) throw new PortalBlockedError(d.url, code, JSON.stringify(p.error));
    throw new Error(`Open-data API error: ${JSON.stringify(p.error ?? p)}`);
  }
  const rows = d.kind === "socrata" ? p : d.kind === "arcgis" ? p?.features : d.kind === "ckan" ? p?.result?.records : p?.rows;
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Malformed open-data response");
  return { rows, more: d.kind === "arcgis" ? p.exceededTransferLimit : undefined };
}
async function fetchPayload(ctx: AdapterCtx, url: string): Promise<unknown> {
  const res = await politeFetch(url, {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
  const body = await res.text();
  if (/^\s*</.test(body) && /captcha|cloudflare|incapsula|verify (?:you are|that you are) human|access denied/i.test(body)) {
    throw new PortalBlockedError(url, res.status, "Open-data endpoint returned an HTML access challenge");
  }
  if (!res.ok) throw new Error(`Open-data endpoint returned HTTP ${res.status}`);
  try { return JSON.parse(body); } catch { throw new Error("Open-data endpoint returned invalid JSON"); }
}
async function query(ctx: AdapterCtx, d: Dataset, where: string): Promise<PermitRecord[]> {
  const records: PermitRecord[] = [];
  let offset = 0;
  let previous: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const payload = await fetchPayload(ctx, buildQuery(d, where, offset));
    const { rows, more } = responseRows(d, payload);
    const fingerprint = JSON.stringify(rows);
    if (rows.length && fingerprint === previous) throw new Error("Portal ignored pagination");
    previous = fingerprint;
    records.push(...rows.map(row => parseRow(d, row, ctx)));
    offset += rows.length;
    if (more === false || (more !== true && rows.length < PAGE_SIZE)) return records;
    if (!rows.length) throw new Error("Portal reports more records but returned no page");
  }
  throw new Error("Open-data pagination limit exceeded; narrow the query");
}
const adapter: PortalAdapter = {
  platform: "Open data",
  capabilities: { search: ["address", "permit", "name", "company", "license", "keyword"], listRecent: true, detail: false },
  async search(ctx, q) { const d = datasetFor(ctx); return query(ctx, d, searchWhere(d, q)); },
  async listRecent(ctx, since) { const d = datasetFor(ctx); return query(ctx, d, recentWhere(d, since)); },
};
export default adapter;
