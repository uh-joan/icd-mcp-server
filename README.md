# ICD-10-CM and NPI MCP Server

A lightweight server that exposes the National Library of Medicine's ICD-10-CM code search API and NPI (National Provider Identifier) search API via the Model Context Protocol (MCP) and HTTP.

## About this Server
- **Project:** `icd-mcp-server`
- **Version:** 0.1
- **License:** MIT

This server provides a bridge between the Model Context Protocol (MCP) and the NLM APIs. It supports both MCP (stdio) and HTTP server modes for flexible integration.

## Available Tools

### 1. ICD-10-CM Code Search

#### What is ICD-10-CM?
ICD-10-CM (International Classification of Diseases, 10th Revision, Clinical Modification) is a medical coding system for classifying diagnoses and reasons for visits in U.S. health care settings.

- **Current version:** ICD-10-CM 2025
- **Data version:** 2025; 74,260 records
- **More info:** [CDC ICD-10-CM](https://www.cdc.gov/nchs/icd/icd10cm.htm)

#### API Details
- **Base URL:** `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search`
- **Official docs:** [NLM Clinical Tables API](https://clinicaltables.nlm.nih.gov/apidoc/icd10cm/v3/doc.html)

#### Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `terms`   |         | **Required.** The search string (e.g., part of a word/code) to match. Multiple words are ANDed. |
| `maxList` | 500     | Optional. Max number of results. |
| `count`   | 500     | Number of results to retrieve (page size). |
| `offset`  | 0       | Starting result number (for pagination). |
| `sf`      | code,name | Comma-separated list of fields to search. |
| `q`       |         | Optional. Additional query string to further constrain results. Supports wildcards and field names. |
| `df`      | code,name | Comma-separated list of display fields. |
| `cf`      | code    | Comma-separated list of fields to count matches in. |

#### Extra Fields (ef)
The API supports an optional `ef` parameter to request additional fields in the response. Available extra fields include:

- **excludes**: Lists conditions or codes that are excluded from the current code.
- **includes**: Lists conditions or codes that are included under the current code.
- **notes**: Additional notes or instructions related to the code.
- **category**: The category or chapter the code belongs to.
- **subcategory**: A more specific subcategory of the code.
- **parent**: The parent code or category.
- **block**: The block or range the code belongs to.
- **chapter**: The chapter number or name in the ICD-10-CM classification.

#### Example Queries
- Search for tuberculosis-related codes:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=tuberc`
- Search for codes starting with A15:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=A15`
- Search for tuberculosis-related codes with additional constraint:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=tuberc&q=code:A15*`

#### Using the Tool

##### HTTP Mode
POST to `/search_icd10cm_codes` with JSON body:
```json
{ "terms": "tuberc"}
```

Response:
```json
{
  "total": 71,
  "codes": [
    { "code": "A15.0", "name": "Tuberculosis of lung" },
    ...
  ]
}
```

##### MCP Mode
```json
{
  "tool": "search_icd10cm_codes",
  "arguments": { "terms": "tuberc"}
}
```

### 2. NPI Provider Search

#### What is NPI?
The National Provider Identifier (NPI) is a unique identification number for covered healthcare providers. The NPI is a 10-position, intelligence-free numeric identifier (10-digit number).

- **Data version:** 2025-05-12; 1,814,275 records
- **More info:** [NPI Registry](https://npiregistry.cms.hhs.gov/)

#### API Details
- **Base URL:** `https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search`
- **Official docs:** [NLM Clinical Tables API](https://clinicaltables.nlm.nih.gov/apidoc/npi_org/v3/doc.html)

#### Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `terms`   |         | **Required.** The search string (e.g., part of a word/code) to match. Multiple words are ANDed. |
| `maxList` | 500     | Optional. Max number of results. |
| `count`   | 500     | Number of results to retrieve (page size). |
| `offset`  | 0       | Starting result number (for pagination). |
| `sf`      | NPI,name.full,provider_type,addr_practice.full | Fields to search in. Common values: |
|           |         | - `NPI`: Provider's NPI number |
|           |         | - `name.full`: Provider's full name |
|           |         | - `provider_type`: Type of provider (Individual/Organization) |
|           |         | - `addr_practice.full`: Practice address |
|           |         | - `addr_practice.city`: Practice city |
|           |         | - `addr_practice.state`: Practice state |
|           |         | - `addr_practice.zip`: Practice ZIP code |
| `df`      | NPI,name.full,provider_type,addr_practice.full | Fields to display in results |
| `ef`      |         | Extra fields to include. Common values: |
|           |         | - `other_ids`: Other provider identifiers |
|           |         | - `taxonomy`: Provider's taxonomy codes |
|           |         | - `addr_mailing`: Mailing address |
|           |         | - `addr_practice`: Practice address details |
|           |         | - `phone`: Contact phone numbers |
|           |         | - `fax`: Fax numbers |
|           |         | - `email`: Email addresses |
|           |         | - `website`: Provider websites |
| `q`       |         | Query constraints. Examples: |
|           |         | - `addr_practice.city:Bethesda` |
|           |         | - `provider_type:Individual` |
|           |         | - `taxonomy:207Q00000X` |

#### Example Queries
- Search for providers named "john" in Bethesda:
  - `https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search?terms=john&q=addr_practice.city:Bethesda`
- Search for providers with last name "williams" and additional IDs:
  - `https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search?terms=williams&ef=other_ids`

#### Detailed Examples

##### Search for providers in Bethesda
```json
{
  "terms": "john",
  "q": "addr_practice.city:Bethesda AND provider_type:Physician",
  "sf": "NPI,name.full,provider_type,addr_practice.city",
  "df": "NPI,name.full,provider_type,addr_practice"
}
```

Response:
```json
{
  "total": 10,
  "providers": [
    {
      "npi": "1417038803",
      "name": "JOHN KEELING",
      "type": "Physician/Osteopathic Manipulative Medicine",
      "address": "8901 ROCKVILLE PIKE, BETHESDA, MD 20889",
      "addr_practice": {
        "line1": "8901 ROCKVILLE PIKE",
        "city": "BETHESDA",
        "state": "MD",
        "zip": "20889",
        "country": "US",
        "phone": "(301) 295-0730",
        "zip4": "5600",
        "full": "8901 ROCKVILLE PIKE, BETHESDA, MD 20889"
      }
    }
  ]
}
```

##### Search for organizations with detailed address
```json
{
  "terms": "hospital",
  "q": "provider_type:Organization",
  "ef": "taxonomy,addr_practice",
  "df": "NPI,name.full,provider_type,addr_practice,taxonomy",
  "count": 2
}
```

Response:
```json
{
  "total": 68,
  "providers": [
    {
      "npi": "1962887356",
      "name": "BEVERLY HOSPITAL",
      "type": "Health Maintenance Organization",
      "address": "85 HERRICK ST, BEVERLY, MA 01915",
      "addr_practice": {
        "line1": "85 HERRICK ST",
        "city": "BEVERLY",
        "state": "MA",
        "zip": "01915",
        "country": "US",
        "phone": "(978) 922-3000",
        "zip4": "1790",
        "full": "85 HERRICK ST, BEVERLY, MA 01915"
      },
      "taxonomy": null
    }
  ]
}
```

##### Search with pagination and extra fields
```json
{
  "terms": "smith",
  "count": 3,
  "offset": 0,
  "ef": "taxonomy,addr_practice",
  "df": "NPI,name.full,provider_type,addr_practice,taxonomy"
}
```

Response:
```json
{
  "total": 5899,
  "providers": [
    {
      "npi": "1841356011",
      "name": "LUXOTTICA RETAIL NORTH AMERICA INC",
      "type": "Eyewear Supplier",
      "address": "4 SMITH HAVEN MALL SMITH HAVEN MALL, LAKE GROVE, NY 11755",
      "addr_practice": {
        "line1": "4 SMITH HAVEN MALL",
        "line2": "SMITH HAVEN MALL",
        "city": "LAKE GROVE",
        "state": "NY",
        "zip": "11755",
        "country": "US",
        "phone": "(631) 361-5289",
        "zip4": "1219",
        "full": "4 SMITH HAVEN MALL SMITH HAVEN MALL, LAKE GROVE, NY 11755"
      },
      "taxonomy": null
    }
  ]
}
```

#### Using the Tool

##### HTTP Mode
POST to `/search_npi_providers` with JSON body containing the search parameters.

##### MCP Mode
```json
{
  "tool": "search_npi_providers",
  "arguments": { "terms": "john", "q": "addr_practice.city:Bethesda" }
}
```

## Usage

### HTTP Mode
Run the server in HTTP mode:
```bash
USE_HTTP=true PORT=3005 npm start
```

Make requests to the endpoints:
- `/search_icd10cm_codes` for ICD-10-CM searches
- `/search_npi_providers` for NPI searches

### MCP Mode
Run the server in MCP mode:
```bash
npm start
```

The server will be available through the MCP protocol.

## Terms of Service
This service is provided "as is" and free of charge. See the [NLM FAQ](https://clinicaltables.nlm.nih.gov/faq.html) for more details.