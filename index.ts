#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createError, JsonValue } from "./util.js";
import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import 'dotenv/config';
import http from 'http';
import { createServer } from "http";
import { URL } from "url";
import { URLSearchParams } from "url";
import { Tool } from "./types";

/**
 * Logging utility for consistent log format across the application
 */
const logger = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  } as const,
  level: (process.env.LOG_LEVEL || 'info') as LogLevel,
  
  formatMessage: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    return JSON.stringify({ timestamp, level, message, ...meta });
  },

  error: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.error) {
      process.stderr.write(logger.formatMessage('error', message, meta) + '\n');
    }
  },

  warn: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.warn) {
      process.stderr.write(logger.formatMessage('warn', message, meta) + '\n');
    }
  },

  info: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.info) {
      if (!USE_HTTP) {
        process.stderr.write(logger.formatMessage('info', message, meta) + '\n');
      } else {
        process.stdout.write(logger.formatMessage('info', message, meta) + '\n');
      }
    }
  },

  debug: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.debug) {
      if (!USE_HTTP) {
        process.stderr.write(logger.formatMessage('debug', message, meta) + '\n');
      } else {
        process.stdout.write(logger.formatMessage('debug', message, meta) + '\n');
      }
    }
  }
};

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// API configuration and environment variables
const USE_HTTP = process.env.USE_HTTP === 'true';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const TRANSPORT = process.env.TRANSPORT || 'stdio';
const SSE_PATH = process.env.SSE_PATH || '/mcp';
const NLM_API_BASE_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3";
const NPI_API_BASE_URL = "https://clinicaltables.nlm.nih.gov/api/npi_org/v3";

// Tool definition for ICD-10-CM search
const SEARCH_ICD10CM_TOOL = {
  name: "nlm_search_icd10",
  description: "Search for ICD-10-CM codes using the National Library of Medicine (NLM) API",
  input_schema: {
    type: "object",
  properties: {
      terms: { type: "string", description: "The search string for which to find matches in the list." },
      maxList: { type: "number", default: 500, description: "Specifies the number of results requested, up to the upper limit of 500." },
      count: { type: "number", default: 500, description: "The number of results to retrieve (page size)." },
      offset: { type: "number", default: 0, description: "The starting result number (0-based) to retrieve." },
      q: { type: "string", description: "An optional, additional query string used to further constrain the results." },
      df: { type: "string", default: "code,name", description: "A comma-separated list of display fields." },
      sf: { type: "string", default: "code,name", description: "A comma-separated list of fields to be searched." },
      cf: { type: "string", default: "code", description: "A field to regard as the 'code' for the returned item data." },
      ef: { type: "string", description: "A comma-separated list of additional fields to be returned for each retrieved list item." }
    },
    required: ["terms"]
  },
  responseSchema: {
    type: 'object',
    properties: {
      total: { type: 'number', description: 'Total number of results available' },
      codes: { 
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'ICD-10-CM code' },
            name: { type: 'string', description: 'Description of the diagnosis' }
            // extra fields will be added dynamically
          }
        }
      }
    }
  },
  examples: [
    {
      description: 'Returns a complete count of the 78 diagnoses that match the string "tuberc", displaying both the ICD-10-CM code and its associated term',
      usage: '{ "terms": "tuberc"}',
      response: '{ "total": 78, "codes": [{ "code": "A15.0", "name": "Tuberculosis of lung" }, { "code": "A15.4", "name": "Tuberculosis of intrathoracic lymph nodes" }, { "code": "A15.5", "name": "Tuberculosis of larynx, trachea and bronchus" }] }'
    },
    {
      description: 'Returns all specific respiratory tuberculosis diagnoses (A15 series) by using the q parameter to filter codes starting with "A15"',
      usage: '{ "terms": "tuberc", "q": "code:A15*" }',
      response: '{ "total": 7, "codes": [{ "code": "A15.0", "name": "Tuberculosis of lung" }, { "code": "A15.4", "name": "Tuberculosis of intrathoracic lymph nodes" }, { "code": "A15.5", "name": "Tuberculosis of larynx, trachea and bronchus" }, { "code": "A15.6", "name": "Tuberculous pleurisy" }, { "code": "A15.7", "name": "Primary respiratory tuberculosis" }, { "code": "A15.8", "name": "Other respiratory tuberculosis" }, { "code": "A15.9", "name": "Respiratory tuberculosis unspecified" }] }'
    },
    {
      description: 'Returns all diagnoses starting with code A02 (Salmonella infections) by searching directly for the code prefix',
      usage: '{ "terms": "A02" }',
      response: '{ "total": 11, "codes": [{ "code": "A02.0", "name": "Salmonella enteritis" }, { "code": "A02.1", "name": "Salmonella sepsis" }, { "code": "A02.20", "name": "Localized salmonella infection, unspecified" }, { "code": "A02.21", "name": "Salmonella meningitis" }, { "code": "A02.22", "name": "Salmonella pneumonia" }, { "code": "A02.23", "name": "Salmonella arthritis" }, { "code": "A02.24", "name": "Salmonella osteomyelitis" }] }'
    }
  ]
};

export const SEARCH_NPI_TOOL: Tool = {
  name: "nlm_search_npi_providers",
  description: "Search for healthcare providers using the National Library of Medicine's (NLM) National Provider Identifier (NPI) database. Supports filtering by name, location, provider type, and other criteria.",
  inputSchema: {
    type: "object",
    properties: {
      terms: {
        type: "string",
        description: "Search terms (name, NPI, or other identifiers). Multiple words are ANDed together."
      },
      maxList: {
        type: "number",
        description: "Maximum number of results to return (default: 500)."
      },
      count: {
        type: "number",
        description: "Number of results per page (default: 500). Use for pagination."
      },
      offset: {
        type: "number",
        description: "Starting result number (default: 0). Use for pagination."
      },
      q: {
        type: "string",
        description: "Additional query constraints. Examples:\n" +
          "- addr_practice.city:Bethesda\n" +
          "- provider_type:Physician\n" +
          "- provider_type:Organization\n" +
          "- addr_practice.state:NY AND provider_type:Individual"
      },
      df: {
        type: "string",
        description: "Comma-separated list of fields to display in results. Common values:\n" +
          "- NPI: Provider's NPI number\n" +
          "- name.full: Provider's full name\n" +
          "- provider_type: Type of provider\n" +
          "- addr_practice: Full practice address\n" +
          "- addr_practice.city: Practice city\n" +
          "- addr_practice.state: Practice state\n" +
          "- addr_practice.zip: Practice ZIP code\n" +
          "- taxonomy: Provider's taxonomy codes"
      },
      sf: {
        type: "string",
        description: "Comma-separated list of fields to search in. Common values:\n" +
          "- NPI: Provider's NPI number\n" +
          "- name.full: Provider's full name\n" +
          "- provider_type: Type of provider\n" +
          "- addr_practice.full: Practice address\n" +
          "- addr_practice.city: Practice city\n" +
          "- addr_practice.state: Practice state\n" +
          "- addr_practice.zip: Practice ZIP code"
      },
      ef: {
        type: "string",
        description: "Comma-separated list of extra fields to include. Common values:\n" +
          "- other_ids: Other provider identifiers\n" +
          "- taxonomy: Provider's taxonomy codes\n" +
          "- addr_mailing: Mailing address\n" +
          "- addr_practice: Practice address details\n" +
          "- phone: Contact phone numbers\n" +
          "- fax: Fax numbers\n" +
          "- email: Email addresses\n" +
          "- website: Provider websites"
      }
    },
    required: ["terms"]
  },
  responseSchema: {
    type: "object",
    properties: {
      total: {
        type: "number",
        description: "Total number of matching providers"
      },
      providers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            npi: {
              type: "string",
              description: "Provider's NPI number"
            },
            name: {
              type: "string",
              description: "Provider's full name"
            },
            type: {
              type: "string",
              description: "Provider's type (e.g., 'Physician/Urology', 'Health Maintenance Organization')"
            },
            address: {
              type: "string",
              description: "Provider's practice address"
            },
            addr_practice: {
              type: "object",
              description: "Detailed practice address information",
              properties: {
                line1: { type: "string", description: "Street address line 1" },
                line2: { type: "string", description: "Street address line 2 (optional)" },
                city: { type: "string", description: "City" },
                state: { type: "string", description: "State" },
                zip: { type: "string", description: "ZIP code" },
                country: { type: "string", description: "Country code" },
                phone: { type: "string", description: "Phone number" },
                fax: { type: "string", description: "Fax number (optional)" },
                zip4: { type: "string", description: "ZIP+4 code (optional)" },
                full: { type: "string", description: "Full formatted address" }
              }
            },
            taxonomy: {
              type: ["string", "null"],
              description: "Provider's taxonomy codes (if requested and available)"
            },
            other_ids: {
              type: ["string", "null"],
              description: "Other provider identifiers (if requested and available)"
            }
          }
        }
      }
    }
  },
  examples: [
    {
      name: "Search for providers in Bethesda",
      input: {
        terms: "john",
        q: "addr_practice.city:Bethesda AND provider_type:Physician",
        sf: "NPI,name.full,provider_type,addr_practice.city",
        df: "NPI,name.full,provider_type,addr_practice"
      },
      output: {
        total: 10,
        providers: [
          {
            npi: "1417038803",
            name: "JOHN KEELING",
            type: "Physician/Osteopathic Manipulative Medicine",
            address: "8901 ROCKVILLE PIKE, BETHESDA, MD 20889",
            addr_practice: {
              line1: "8901 ROCKVILLE PIKE",
              city: "BETHESDA",
              state: "MD",
              zip: "20889",
              country: "US",
              phone: "(301) 295-0730",
              zip4: "5600",
              full: "8901 ROCKVILLE PIKE, BETHESDA, MD 20889"
            }
          }
        ]
      }
    },
    {
      name: "Search for organizations with detailed address",
      input: {
        terms: "hospital",
        q: "provider_type:Organization",
        ef: "taxonomy,addr_practice",
        df: "NPI,name.full,provider_type,addr_practice,taxonomy",
        count: 2
      },
      output: {
        total: 68,
        providers: [
          {
            npi: "1962887356",
            name: "BEVERLY HOSPITAL",
            type: "Health Maintenance Organization",
            address: "85 HERRICK ST, BEVERLY, MA 01915",
            addr_practice: {
              line1: "85 HERRICK ST",
              city: "BEVERLY",
              state: "MA",
              zip: "01915",
              country: "US",
              phone: "(978) 922-3000",
              zip4: "1790",
              full: "85 HERRICK ST, BEVERLY, MA 01915"
            },
            taxonomy: null
          }
        ]
      }
    },
    {
      name: "Search with pagination and extra fields",
      input: {
        terms: "smith",
        count: 3,
        offset: 0,
        ef: "taxonomy,addr_practice",
        df: "NPI,name.full,provider_type,addr_practice,taxonomy"
      },
      output: {
        total: 5899,
        providers: [
          {
            npi: "1841356011",
            name: "LUXOTTICA RETAIL NORTH AMERICA INC",
            type: "Eyewear Supplier",
            address: "4 SMITH HAVEN MALL SMITH HAVEN MALL, LAKE GROVE, NY 11755",
            addr_practice: {
              line1: "4 SMITH HAVEN MALL",
              line2: "SMITH HAVEN MALL",
              city: "LAKE GROVE",
              state: "NY",
              zip: "11755",
              country: "US",
              phone: "(631) 361-5289",
              zip4: "1219",
              full: "4 SMITH HAVEN MALL SMITH HAVEN MALL, LAKE GROVE, NY 11755"
            },
            taxonomy: null
          }
        ]
      }
    }
  ]
};

export const SEARCH_MEDICARE_TOOL: Tool = {
  name: "cms_search_providers",
  description: "Search Medicare Physician & Other Practitioners data for 2023 using the Centers for Medicare & Medicaid Services (CMS) database. This data includes information about services and procedures provided to Original Medicare Part B beneficiaries.",
  inputSchema: {
    type: "object",
    properties: {
      dataset_type: {
        type: "string",
        description: "Type of dataset to search. Each dataset serves a different analytical purpose:\n" +
          "- 'geography_and_service': Aggregates data by geographic area (National, State, County, or ZIP) and service. Use this for regional healthcare analysis, understanding service patterns across different regions, and comparing healthcare metrics between areas.\n" +
          "- 'provider_and_service': Shows individual provider-level data for specific services. Use this for finding specific providers who perform certain services, analyzing provider service patterns, and comparing provider performance for specific procedures.\n" +
          "- 'provider': Provides comprehensive provider-level data aggregated across all their services. Use this for analyzing provider practice patterns, understanding patient demographics, and evaluating provider performance across their entire practice.",
        enum: ["geography_and_service", "provider_and_service", "provider"],
        default: "geography_and_service"
      },
      hcpcs_code: {
        type: "string",
        description: "Healthcare Common Procedure Coding System (HCPCS) code"
      },
      geo_level: {
        type: "string",
        description: "Geographic level of data (only for geography_and_service dataset)",
        enum: ["National", "State", "County", "Zip"]
      },
      geo_code: {
        type: "string",
        description: "Geographic code (state code, county code, or ZIP code) (only for geography_and_service dataset)"
      },
      place_of_service: {
        type: "string",
        description: "Place of service code",
        enum: ["F", "O"]
      },
      size: {
        type: "number",
        description: "Number of results to return (default: 10, max: 5000)"
      },
      offset: {
        type: "number",
        description: "Starting result number (default: 0)"
      },
      keyword: {
        type: "string",
        description: "Search term for quick full-text search across all fields"
      },
      sort: {
        type: "object",
        description: "Sort results by field",
        properties: {
          field: {
            type: "string",
            description: "Field to sort by",
            enum: [
              "HCPCS_Cd",
              "HCPCS_Desc",
              "Tot_Rndrng_Prvdrs",
              "Tot_Benes",
              "Tot_Srvcs",
              "Avg_Sbmtd_Chrg",
              "Avg_Mdcr_Alowd_Amt",
              "Avg_Mdcr_Pymt_Amt",
              "Rndrng_Prvdr_Last_Org_Name",
              "Rndrng_Prvdr_Type",
              "Tot_HCPCS_Cds",
              "Tot_Sbmtd_Chrg",
              "Tot_Mdcr_Alowd_Amt",
              "Tot_Mdcr_Pymt_Amt",
              "Bene_Avg_Age",
              "Bene_Avg_Risk_Scre"
            ]
          },
          direction: {
            type: "string",
            description: "Sort direction",
            enum: ["asc", "desc"]
          }
        }
      }
    },
    required: []
  },
  responseSchema: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            // Common fields for all datasets
            hcpcs_code: { type: "string", description: "HCPCS code" },
            hcpcs_desc: { type: "string", description: "HCPCS description" },
            hcpcs_drug_ind: { type: "string", description: "HCPCS drug indicator" },
            place_of_service: { type: "string", description: "Place of service code" },
            total_beneficiaries: { type: "number", description: "Total number of beneficiaries" },
            total_services: { type: "number", description: "Total number of services" },
            total_beneficiary_days: { type: "number", description: "Total beneficiary days of service" },
            avg_submitted_charge: { type: "number", description: "Average submitted charge amount" },
            avg_medicare_allowed: { type: "number", description: "Average Medicare allowed amount" },
            avg_medicare_payment: { type: "number", description: "Average Medicare payment amount" },
            avg_medicare_standardized: { type: "number", description: "Average Medicare standardized amount" },
            // Geography dataset specific fields
            geo_level: { type: "string", description: "Geographic level" },
            geo_code: { type: "string", description: "Geographic code" },
            geo_desc: { type: "string", description: "Geographic description" },
            total_providers: { type: "number", description: "Total number of rendering providers" },
            // Provider dataset specific fields
            npi: { type: "string", description: "Provider's NPI number" },
            provider_name: { type: "string", description: "Provider's full name" },
            provider_type: { type: "string", description: "Provider's specialty or type" },
            provider_address: { type: "string", description: "Provider's address" },
            provider_city: { type: "string", description: "Provider's city" },
            provider_state: { type: "string", description: "Provider's state" },
            provider_zip: { type: "string", description: "Provider's ZIP code" },
            provider_country: { type: "string", description: "Provider's country" },
            medicare_participating: { type: "string", description: "Medicare participating indicator" },
            // Provider-only dataset specific fields
            total_hcpcs_codes: { type: "number", description: "Total number of unique HCPCS codes" },
            total_submitted_charges: { type: "number", description: "Total submitted charges" },
            total_medicare_allowed: { type: "number", description: "Total Medicare allowed amount" },
            total_medicare_payment: { type: "number", description: "Total Medicare payment amount" },
            total_medicare_standardized: { type: "number", description: "Total Medicare standardized amount" },
            beneficiary_average_age: { type: "number", description: "Average age of beneficiaries" },
            beneficiary_age_lt_65: { type: "number", description: "Number of beneficiaries under 65" },
            beneficiary_age_65_74: { type: "number", description: "Number of beneficiaries aged 65-74" },
            beneficiary_age_75_84: { type: "number", description: "Number of beneficiaries aged 75-84" },
            beneficiary_age_gt_84: { type: "number", description: "Number of beneficiaries over 84" },
            beneficiary_female_count: { type: "number", description: "Number of female beneficiaries" },
            beneficiary_male_count: { type: "number", description: "Number of male beneficiaries" },
            beneficiary_race_white: { type: "number", description: "Number of white beneficiaries" },
            beneficiary_race_black: { type: "number", description: "Number of black beneficiaries" },
            beneficiary_race_api: { type: "number", description: "Number of Asian/Pacific Islander beneficiaries" },
            beneficiary_race_hispanic: { type: "number", description: "Number of Hispanic beneficiaries" },
            beneficiary_race_native: { type: "number", description: "Number of Native American beneficiaries" },
            beneficiary_race_other: { type: "number", description: "Number of other race beneficiaries" },
            beneficiary_dual_count: { type: "number", description: "Number of dual-eligible beneficiaries" },
            beneficiary_non_dual_count: { type: "number", description: "Number of non-dual-eligible beneficiaries" },
            beneficiary_average_risk_score: { type: "number", description: "Average risk score of beneficiaries" }
          }
        }
      },
      total: { type: "number", description: "Total number of results" }
    }
  },
  examples: [
    {
      name: "Search for office visit codes by state (geography_and_service dataset)",
      input: {
        dataset_type: "geography_and_service",
        hcpcs_code: "99213",
        geo_level: "State",
        size: 2
      },
      output: {
        total: 2,
        providers: [
          {
            geo_level: "State",
            geo_code: "01",
            geo_desc: "Alabama",
            hcpcs_code: "99213",
            hcpcs_desc: "Established patient office or other outpatient visit, 20-29 minutes",
            hcpcs_drug_ind: "N",
            place_of_service: "F",
            total_providers: 1246,
            total_beneficiaries: 23596,
            total_services: 47657,
            total_beneficiary_days: 47657,
            avg_submitted_charge: 139.55,
            avg_medicare_allowed: 57.99,
            avg_medicare_payment: 41.75,
            avg_medicare_standardized: 44.36
          }
        ]
      }
    },
    {
      name: "Search for providers performing specific service (provider_and_service dataset)",
      input: {
        dataset_type: "provider_and_service",
        hcpcs_code: "99213",
        size: 2
      },
      output: {
        total: 2,
        providers: [
          {
            npi: "1003008533",
            provider_name: "SABODASH, VALERIY",
            provider_type: "Neurology",
            provider_address: "5741 Bee Ridge Rd Ste 530",
            provider_city: "Sarasota",
            provider_state: "FL",
            provider_zip: "34233",
            provider_country: "US",
            medicare_participating: "Y",
            hcpcs_code: "99213",
            hcpcs_desc: "Established patient office or other outpatient visit, 20-29 minutes",
            hcpcs_drug_ind: "N",
            place_of_service: "O",
            total_beneficiaries: 45,
            total_services: 52,
            total_beneficiary_days: 52,
            avg_submitted_charge: 141.00,
            avg_medicare_allowed: 88.44,
            avg_medicare_payment: 63.59,
            avg_medicare_standardized: 64.45
          }
        ]
      }
    },
    {
      name: "Search for provider by NPI (provider dataset)",
      input: {
        dataset_type: "provider",
        keyword: "1003000126",
        size: 2
      },
      output: {
        total: 2,
        providers: [
          {
            npi: "1003000126",
            provider_name: "ENKESHAFI, ARDALAN",
            provider_type: "Hospitalist",
            provider_address: "6410 Rockledge Dr Ste 304",
            provider_city: "Bethesda",
            provider_state: "MD",
            provider_zip: "20817",
            provider_country: "US",
            medicare_participating: "Y",
            total_hcpcs_codes: 11,
            total_beneficiaries: 344,
            total_services: 814,
            total_submitted_charges: 173087.77,
            total_medicare_allowed: 78590.79,
            total_medicare_payment: 62198.36,
            total_medicare_standardized: 56080.64,
            beneficiary_average_age: 78,
            beneficiary_age_lt_65: 28,
            beneficiary_age_65_74: 84,
            beneficiary_age_75_84: 134,
            beneficiary_age_gt_84: 98,
            beneficiary_female_count: 183,
            beneficiary_male_count: 161,
            beneficiary_race_white: 242,
            beneficiary_race_black: 53,
            beneficiary_race_api: 26,
            beneficiary_dual_count: 62,
            beneficiary_non_dual_count: 282,
            beneficiary_average_risk_score: 2.7545
          }
        ]
      }
    },
    {
      name: "Search for providers by specialty (provider dataset)",
      input: {
        dataset_type: "provider",
        keyword: "Hospitalist",
        size: 2,
        sort: {
          field: "Tot_Srvcs",
          direction: "desc"
        }
      },
      output: {
        total: 2,
        providers: [
          {
            npi: "1992932214",
            provider_name: "Makhlouf, Tony",
            provider_type: "Hospitalist",
            provider_address: "143 Parrot Ln",
            provider_city: "Simi Valley",
            provider_state: "CA",
            provider_zip: "93065",
            provider_country: "US",
            medicare_participating: "Y",
            total_hcpcs_codes: 57,
            total_beneficiaries: 653,
            total_services: 298066,
            total_submitted_charges: 7256031.77,
            total_medicare_allowed: 3671684.59,
            total_medicare_payment: 2905424.95,
            total_medicare_standardized: 2866216.13,
            beneficiary_average_age: 76,
            beneficiary_age_lt_65: 37,
            beneficiary_age_65_74: 257,
            beneficiary_age_75_84: 257,
            beneficiary_age_gt_84: 102,
            beneficiary_female_count: 463,
            beneficiary_male_count: 190,
            beneficiary_race_white: 481,
            beneficiary_race_black: "",
            beneficiary_race_api: 33,
            beneficiary_race_hispanic: 100,
            beneficiary_race_native: "",
            beneficiary_race_other: "",
            beneficiary_dual_count: 158,
            beneficiary_non_dual_count: 495,
            beneficiary_average_risk_score: 1.491
          }
        ]
      }
    },
    {
      name: "Search for providers by state with highest Medicare payments (provider dataset)",
      input: {
        dataset_type: "provider",
        geo_code: "CA",
        size: 2,
        sort: {
          field: "Tot_Mdcr_Pymt_Amt",
          direction: "desc"
        }
      },
      output: {
        total: 2,
        providers: [
          {
            npi: "1629407069",
            provider_name: "Exact Sciences Laboratories, Llc",
            provider_type: "Clinical Laboratory",
            provider_address: "145 E Badger Rd Ste 100",
            provider_city: "Madison",
            provider_state: "WI",
            provider_zip: "53713",
            provider_country: "US",
            medicare_participating: "Y",
            total_hcpcs_codes: 1,
            total_beneficiaries: 600418,
            total_services: 600418,
            total_submitted_charges: 408884658,
            total_medicare_allowed: 299319622.61,
            total_medicare_payment: 299319622.61,
            total_medicare_standardized: 299421723.46,
            beneficiary_average_age: 71,
            beneficiary_age_lt_65: 49483,
            beneficiary_age_65_74: 382715,
            beneficiary_age_75_84: 163238,
            beneficiary_age_gt_84: 4982,
            beneficiary_female_count: 364244,
            beneficiary_male_count: 236174,
            beneficiary_race_white: 510661,
            beneficiary_race_black: 27747,
            beneficiary_race_api: 13777,
            beneficiary_race_hispanic: 23680,
            beneficiary_race_native: 1002,
            beneficiary_race_other: 23551,
            beneficiary_dual_count: 72341,
            beneficiary_non_dual_count: 528077,
            beneficiary_average_risk_score: 0.7976
          }
        ]
      }
    }
  ]
};

interface ICD10CMResponse {
  total: number;
  codes: Array<[string, string]>;
  displayData: Array<[string, string]>;
}

interface MedicareProviderGeographyResponse {
  Rndrng_Prvdr_Geo_Lvl: string;
  Rndrng_Prvdr_Geo_Cd: string;
  Rndrng_Prvdr_Geo_Desc: string;
  HCPCS_Cd: string;
  HCPCS_Desc: string;
  HCPCS_Drug_Ind: string;
  Place_Of_Srvc: string;
  Tot_Rndrng_Prvdrs: number;
  Tot_Benes: number;
  Tot_Srvcs: number;
  Tot_Bene_Day_Srvcs: number;
  Avg_Sbmtd_Chrg: number;
  Avg_Mdcr_Alowd_Amt: number;
  Avg_Mdcr_Pymt_Amt: number;
  Avg_Mdcr_Stdzd_Amt: number;
}

interface MedicareProviderIndividualResponse {
  Rndrng_NPI: string;
  Rndrng_Prvdr_Last_Org_Name: string;
  Rndrng_Prvdr_First_Name: string;
  Rndrng_Prvdr_MI: string;
  Rndrng_Prvdr_Crdntls: string;
  Rndrng_Prvdr_Ent_Cd: string;
  Rndrng_Prvdr_St1: string;
  Rndrng_Prvdr_St2: string;
  Rndrng_Prvdr_City: string;
  Rndrng_Prvdr_State_Abrvtn: string;
  Rndrng_Prvdr_State_FIPS: string;
  Rndrng_Prvdr_Zip5: string;
  Rndrng_Prvdr_RUCA: string;
  Rndrng_Prvdr_RUCA_Desc: string;
  Rndrng_Prvdr_Cntry: string;
  Rndrng_Prvdr_Type: string;
  Rndrng_Prvdr_Mdcr_Prtcptg_Ind: string;
  HCPCS_Cd: string;
  HCPCS_Desc: string;
  HCPCS_Drug_Ind: string;
  Place_Of_Srvc: string;
  Tot_Benes: number;
  Tot_Srvcs: number;
  Tot_Bene_Day_Srvcs: number;
  Avg_Sbmtd_Chrg: number;
  Avg_Mdcr_Alowd_Amt: number;
  Avg_Mdcr_Pymt_Amt: number;
  Avg_Mdcr_Stdzd_Amt: number;
}

interface MedicareProviderResponse {
  Rndrng_NPI: string;
  Rndrng_Prvdr_Last_Org_Name: string;
  Rndrng_Prvdr_First_Name: string;
  Rndrng_Prvdr_MI: string;
  Rndrng_Prvdr_Crdntls: string;
  Rndrng_Prvdr_Ent_Cd: string;
  Rndrng_Prvdr_St1: string;
  Rndrng_Prvdr_St2: string;
  Rndrng_Prvdr_City: string;
  Rndrng_Prvdr_State_Abrvtn: string;
  Rndrng_Prvdr_State_FIPS: string;
  Rndrng_Prvdr_Zip5: string;
  Rndrng_Prvdr_RUCA: string;
  Rndrng_Prvdr_RUCA_Desc: string;
  Rndrng_Prvdr_Cntry: string;
  Rndrng_Prvdr_Type: string;
  Rndrng_Prvdr_Mdcr_Prtcptg_Ind: string;
  Tot_HCPCS_Cds: string;
  Tot_Benes: number;
  Tot_Srvcs: number;
  Tot_Sbmtd_Chrg: number;
  Tot_Mdcr_Alowd_Amt: number;
  Tot_Mdcr_Pymt_Amt: number;
  Tot_Mdcr_Stdzd_Amt: number;
  Bene_Avg_Age: number;
  Bene_Age_LT_65_Cnt: number;
  Bene_Age_65_74_Cnt: number;
  Bene_Age_75_84_Cnt: number;
  Bene_Age_GT_84_Cnt: number;
  Bene_Feml_Cnt: number;
  Bene_Male_Cnt: number;
  Bene_Race_Wht_Cnt: number;
  Bene_Race_Black_Cnt: number;
  Bene_Race_API_Cnt: number;
  Bene_Race_Hspnc_Cnt: number;
  Bene_Race_NatInd_Cnt: number;
  Bene_Race_Othr_Cnt: number;
  Bene_Dual_Cnt: number;
  Bene_Ndual_Cnt: number;
  Bene_Avg_Risk_Scre: number;
}

async function searchICD10CM(
  terms: string,
  maxList: number = 500,
  count: number = 500,
  offset: number = 0,
  q?: string,
  df: string = "code,name",
  sf: string = "code,name",
  cf: string = "code",
  ef?: string
) {
  const query = new URLSearchParams({
    terms,
    maxList: maxList.toString(),
    count: count.toString(),
    offset: offset.toString(),
    df,
    sf,
    cf
  });
  if (q) {
    query.append("q", q);
  }
  if (ef) query.append("ef", ef);

  const fullUrl = `${NLM_API_BASE_URL}/search?${query.toString()}`;

  let response, raw, data;
  try {
    response = await fetch(fullUrl);
    raw = await response.text();
    data = JSON.parse(raw);
  } catch (err) {
    throw err;
  }

  // Prepare extra fields if present
  let extraFields: Record<string, any[]> = {};
  if (ef && data[2]) {
    extraFields = data[2];
  }

  let codes = [];
  try {
    codes = data[1].map((code: string, index: number) => {
      const result: any = {
        code,
        name: Array.isArray(data[3]?.[index]) ? data[3][index][1] : undefined
      };
      // Attach extra fields if present
      if (extraFields && Object.keys(extraFields).length > 0) {
        for (const [field, values] of Object.entries(extraFields)) {
          result[field] = values[index];
        }
      }
      return result;
    });
  } catch (err) {
    throw err;
  }
  return {
    total: data[0],
    codes
  };
}

async function searchNPI(
  terms: string,
  maxList: number = 500,
  count: number = 500,
  offset: number = 0,
  q?: string,
  df: string = "NPI,name.full,provider_type,addr_practice.full",
  sf: string = "NPI,name.full,provider_type,addr_practice.full",
  cf: string = "NPI",
  ef?: string
) {
  const query = new URLSearchParams({
    terms,
    maxList: maxList.toString(),
    count: count.toString(),
    offset: offset.toString(),
    df,
    sf,
    cf
  });
  if (q) query.append("q", q);
  if (ef) query.append("ef", ef);

  const fullUrl = `${NPI_API_BASE_URL}/search?${query.toString()}`;

  let response, raw, data;
  try {
    response = await fetch(fullUrl);
    raw = await response.text();
    data = JSON.parse(raw);
  } catch (err) {
    throw err;
  }

  // Prepare extra fields if present
  let extraFields: Record<string, any[]> = {};
  if (ef && data[2]) {
    extraFields = data[2];
  }

  let providers = [];
  try {
    providers = data[1].map((npi: string, index: number) => {
      const displayData = data[3]?.[index] || [];
      const result: any = {
        npi,
        name: displayData[1] || '',
        type: displayData[2] || '',
        address: displayData[3] || ''
      };
      // Attach extra fields if present
      if (extraFields && Object.keys(extraFields).length > 0) {
        for (const [field, values] of Object.entries(extraFields)) {
          result[field] = values[index];
        }
      }
      return result;
    });
  } catch (err) {
    throw err;
  }
  return {
    total: data[0],
    providers
  };
}

async function searchMedicare(
  dataset_type: string = "geography_and_service",
  hcpcs_code?: string,
  geo_level?: string,
  geo_code?: string,
  place_of_service?: string,
  size: number = 10,
  offset: number = 0,
  keyword?: string,
  sort?: { field: string; direction: 'asc' | 'desc' }
) {
  // Select dataset UUID based on type
  const datasetUuid = dataset_type === "geography_and_service" 
    ? "ddee9e22-7889-4bef-975a-7853e4cd0fbb"  // Geography dataset
    : dataset_type === "provider_and_service"
    ? "0e9f2f2b-7bf9-451a-912c-e02e654dd725"  // Provider and service dataset
    : "8889d81e-2ee7-448f-8713-f071038289b5"; // Provider dataset

  const query = new URLSearchParams({
    size: Math.min(size, 5000).toString(),
    offset: offset.toString()
  });

  if (keyword) {
    query.append("keyword", keyword);
  }

  // Add filters using the JSONAPI filter syntax
  if (hcpcs_code && dataset_type !== "provider") {
    query.append("filter[filter-1][condition][path]", "HCPCS_Cd");
    query.append("filter[filter-1][condition][operator]", "=");
    query.append("filter[filter-1][condition][value]", hcpcs_code);
  }

  if (dataset_type === "geography_and_service") {
    if (geo_level) {
      query.append("filter[filter-2][condition][path]", "Rndrng_Prvdr_Geo_Lvl");
      query.append("filter[filter-2][condition][operator]", "=");
      query.append("filter[filter-2][condition][value]", geo_level);
    }

    if (geo_code) {
      query.append("filter[filter-3][condition][path]", "Rndrng_Prvdr_Geo_Cd");
      query.append("filter[filter-3][condition][operator]", "=");
      query.append("filter[filter-3][condition][value]", geo_code);
    }
  }

  if (place_of_service && dataset_type !== "provider") {
    query.append("filter[filter-4][condition][path]", "Place_Of_Srvc");
    query.append("filter[filter-4][condition][operator]", "=");
    query.append("filter[filter-4][condition][value]", place_of_service);
  }

  if (sort) {
    query.append("sort", `${sort.direction === 'desc' ? '-' : ''}${sort.field}`);
  }

  const url = `https://data.cms.gov/data-api/v1/dataset/${datasetUuid}/data?${query.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json() as (MedicareProviderGeographyResponse[] | MedicareProviderIndividualResponse[] | MedicareProviderResponse[]);

    return {
      total: data.length,
      providers: data.map((item) => {
        if (dataset_type === "provider") {
          const providerItem = item as MedicareProviderResponse;
          return {
            npi: providerItem.Rndrng_NPI,
            provider_name: `${providerItem.Rndrng_Prvdr_Last_Org_Name}, ${providerItem.Rndrng_Prvdr_First_Name}${providerItem.Rndrng_Prvdr_MI ? ` ${providerItem.Rndrng_Prvdr_MI}` : ''}`,
            provider_type: providerItem.Rndrng_Prvdr_Type,
            provider_address: providerItem.Rndrng_Prvdr_St1,
            provider_city: providerItem.Rndrng_Prvdr_City,
            provider_state: providerItem.Rndrng_Prvdr_State_Abrvtn,
            provider_zip: providerItem.Rndrng_Prvdr_Zip5,
            provider_country: providerItem.Rndrng_Prvdr_Cntry,
            medicare_participating: providerItem.Rndrng_Prvdr_Mdcr_Prtcptg_Ind,
            total_hcpcs_codes: parseInt(providerItem.Tot_HCPCS_Cds),
            total_beneficiaries: providerItem.Tot_Benes,
            total_services: providerItem.Tot_Srvcs,
            total_submitted_charges: providerItem.Tot_Sbmtd_Chrg,
            total_medicare_allowed: providerItem.Tot_Mdcr_Alowd_Amt,
            total_medicare_payment: providerItem.Tot_Mdcr_Pymt_Amt,
            total_medicare_standardized: providerItem.Tot_Mdcr_Stdzd_Amt,
            beneficiary_average_age: providerItem.Bene_Avg_Age,
            beneficiary_age_lt_65: providerItem.Bene_Age_LT_65_Cnt,
            beneficiary_age_65_74: providerItem.Bene_Age_65_74_Cnt,
            beneficiary_age_75_84: providerItem.Bene_Age_75_84_Cnt,
            beneficiary_age_gt_84: providerItem.Bene_Age_GT_84_Cnt,
            beneficiary_female_count: providerItem.Bene_Feml_Cnt,
            beneficiary_male_count: providerItem.Bene_Male_Cnt,
            beneficiary_race_white: providerItem.Bene_Race_Wht_Cnt,
            beneficiary_race_black: providerItem.Bene_Race_Black_Cnt,
            beneficiary_race_api: providerItem.Bene_Race_API_Cnt,
            beneficiary_race_hispanic: providerItem.Bene_Race_Hspnc_Cnt,
            beneficiary_race_native: providerItem.Bene_Race_NatInd_Cnt,
            beneficiary_race_other: providerItem.Bene_Race_Othr_Cnt,
            beneficiary_dual_count: providerItem.Bene_Dual_Cnt,
            beneficiary_non_dual_count: providerItem.Bene_Ndual_Cnt,
            beneficiary_average_risk_score: providerItem.Bene_Avg_Risk_Scre
          };
        }

        if (dataset_type === "geography_and_service") {
          const geoItem = item as MedicareProviderGeographyResponse;
          return {
            hcpcs_code: geoItem.HCPCS_Cd,
            hcpcs_desc: geoItem.HCPCS_Desc,
            hcpcs_drug_ind: geoItem.HCPCS_Drug_Ind,
            place_of_service: geoItem.Place_Of_Srvc,
            total_beneficiaries: geoItem.Tot_Benes,
            total_services: geoItem.Tot_Srvcs,
            total_beneficiary_days: geoItem.Tot_Bene_Day_Srvcs,
            avg_submitted_charge: geoItem.Avg_Sbmtd_Chrg,
            avg_medicare_allowed: geoItem.Avg_Mdcr_Alowd_Amt,
            avg_medicare_payment: geoItem.Avg_Mdcr_Pymt_Amt,
            avg_medicare_standardized: geoItem.Avg_Mdcr_Stdzd_Amt,
            geo_level: geoItem.Rndrng_Prvdr_Geo_Lvl,
            geo_code: geoItem.Rndrng_Prvdr_Geo_Cd,
            geo_desc: geoItem.Rndrng_Prvdr_Geo_Desc,
            total_providers: geoItem.Tot_Rndrng_Prvdrs
          };
        } else {
          const providerItem = item as MedicareProviderIndividualResponse;
          return {
            hcpcs_code: providerItem.HCPCS_Cd,
            hcpcs_desc: providerItem.HCPCS_Desc,
            hcpcs_drug_ind: providerItem.HCPCS_Drug_Ind,
            place_of_service: providerItem.Place_Of_Srvc,
            total_beneficiaries: providerItem.Tot_Benes,
            total_services: providerItem.Tot_Srvcs,
            total_beneficiary_days: providerItem.Tot_Bene_Day_Srvcs,
            avg_submitted_charge: providerItem.Avg_Sbmtd_Chrg,
            avg_medicare_allowed: providerItem.Avg_Mdcr_Alowd_Amt,
            avg_medicare_payment: providerItem.Avg_Mdcr_Pymt_Amt,
            avg_medicare_standardized: providerItem.Avg_Mdcr_Stdzd_Amt,
            npi: providerItem.Rndrng_NPI,
            provider_name: `${providerItem.Rndrng_Prvdr_Last_Org_Name}, ${providerItem.Rndrng_Prvdr_First_Name}${providerItem.Rndrng_Prvdr_MI ? ` ${providerItem.Rndrng_Prvdr_MI}` : ''}`,
            provider_type: providerItem.Rndrng_Prvdr_Type,
            provider_address: providerItem.Rndrng_Prvdr_St1,
            provider_city: providerItem.Rndrng_Prvdr_City,
            provider_state: providerItem.Rndrng_Prvdr_State_Abrvtn,
            provider_zip: providerItem.Rndrng_Prvdr_Zip5,
            provider_country: providerItem.Rndrng_Prvdr_Cntry,
            medicare_participating: providerItem.Rndrng_Prvdr_Mdcr_Prtcptg_Ind
          };
        }
      })
    };
  } catch (error) {
    throw error;
  }
}

function sendError(res: http.ServerResponse, message: string, code: number = 400) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, code }));
}

async function runServer() {
  if (USE_HTTP) {
    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const method = req.method || '';
      const url = req.url || '';

      // Health check endpoint
      if (method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // List tools endpoint
      if (method === 'POST' && url === '/list_tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tools: [
            {
              name: 'nlm_search_icd10',
              description: SEARCH_ICD10CM_TOOL.description,
              schema: [
                { name: 'terms', type: 'string', description: 'Search terms (code or name) to find matches in the list' },
                { name: 'maxList', type: 'number', description: 'Maximum number of results to return (default: 7, max: 500)', default: 7 }
              ]
            }
          ]
        }));
        return;
      }

      // Helper to parse JSON body
      const parseBody = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: any) => { body += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });

      // Routing for all tools
      if (method === 'POST') {
        let data: any;
        let result: any;
        try {
          data = await parseBody(req);
          const url = req.url || '';
          if (url === '/nlm_search_icd10') {
            result = await searchICD10CM(data.terms, data.maxList, data.count, data.offset, data.q, data.df, data.sf, data.cf, data.ef);
          } else if (url === '/nlm_search_npi_providers') {
            result = await searchNPI(data.terms, data.maxList, data.count, data.offset, data.q, data.df, data.sf, data.cf, data.ef);
          } else if (url === '/cms_search_providers') {
            result = await searchMedicare(data.dataset_type, data.hcpcs_code, data.geo_level, data.geo_code, data.place_of_service, data.size, data.offset, data.keyword, data.sort);
          } else {
            sendError(res, 'Not found', 404);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          sendError(res, err instanceof Error ? err.message : String(err));
        }
      } else {
        sendError(res, 'Not found', 404);
      }
    });
    server.listen(PORT, () => {
      // Server is running
    });
    return;
  }
  
  // MCP mode (stdio only)
  const server = new Server(
    {
      name: 'icd10cm',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Set up request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      SEARCH_ICD10CM_TOOL,
      SEARCH_NPI_TOOL,
      SEARCH_MEDICARE_TOOL
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params?.name;
    const args = request.params?.arguments ?? {};
    try {
      switch (toolName) {
        case 'nlm_search_icd10': {
          const a = args as any;
          const result = await searchICD10CM(a.terms, a.maxList, a.count, a.offset, a.q, a.df, a.sf, a.cf, a.ef);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'nlm_search_npi_providers': {
          const a = args as any;
          const result = await searchNPI(a.terms, a.maxList, a.count, a.offset, a.q, a.df, a.sf, a.cf, a.ef);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'cms_search_providers': {
          const a = args as any;
          const result = await searchMedicare(a.dataset_type, a.hcpcs_code, a.geo_level, a.geo_code, a.place_of_service, a.size, a.offset, a.keyword, a.sort);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        default:
          throw new McpError(-32603, 'Unknown tool');
      }
    } catch (error) {
      throw new McpError(-32603, error instanceof Error ? error.message : String(error));
    }
  });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
  logger.error('Server error:', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
