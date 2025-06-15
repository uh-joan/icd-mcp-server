# ICD-10-CM and NPI MCP Server

This server provides access to ICD-10-CM codes and National Provider Identifier (NPI) data through a Model Context Protocol (MCP) interface. It also includes Medicare provider data for 2023.

## About this Server
- **Project:** `icd-mcp-server`
- **Version:** 0.1
- **License:** MIT

## Available Tools

1. `search_icd10cm_codes`: Search for ICD-10-CM codes using the NLM API
2. `search_npi_providers`: Search for healthcare providers using the NPI database
3. `search_medicare_providers`: Search Medicare Physician & Other Practitioners data for 2023

## API Details

### ICD-10-CM Search

The `search_icd10cm_codes` tool provides access to the National Library of Medicine's (NLM) ICD-10-CM code database.

#### Parameters

- `terms` (string, required): The search string for which to find matches in the list
- `maxList` (number, default: 500): Specifies the number of results requested, up to the upper limit of 500
- `count` (number, default: 500): The number of results to retrieve (page size)
- `offset` (number, default: 0): The starting result number (0-based) to retrieve
- `q` (string): An optional, additional query string used to further constrain the results
- `df` (string, default: "code,name"): A comma-separated list of display fields
- `sf` (string, default: "code,name"): A comma-separated list of fields to be searched
- `cf` (string, default: "code"): A field to regard as the 'code' for the returned item data
- `ef` (string): A comma-separated list of additional fields to be returned for each retrieved list item

#### Example Queries

1. Search for tuberculosis-related diagnoses:
```bash
curl -X POST http://localhost:3005/search_icd10cm_codes \
  -H "Content-Type: application/json" \
  -d '{
    "terms": "tuberc"
  }'
```

2. Search for specific respiratory tuberculosis diagnoses:
```bash
curl -X POST http://localhost:3005/search_icd10cm_codes \
  -H "Content-Type: application/json" \
  -d '{
    "terms": "tuberc",
    "q": "code:A15*"
  }'
```

### NPI Provider Search

The `search_npi_providers` tool provides access to the National Provider Identifier (NPI) database, allowing searches for healthcare providers by name, location, provider type, and other criteria.

#### Parameters

- `terms` (string, required): Search terms (name, NPI, or other identifiers). Multiple words are ANDed together
- `maxList` (number, default: 500): Maximum number of results to return
- `count` (number, default: 500): Number of results per page. Use for pagination
- `offset` (number, default: 0): Starting result number. Use for pagination
- `q` (string): Additional query constraints. Examples:
  - `addr_practice.city:Bethesda`
  - `provider_type:Physician`
  - `provider_type:Organization`
  - `addr_practice.state:NY AND provider_type:Individual`
- `df` (string): Comma-separated list of fields to display in results
- `sf` (string): Comma-separated list of fields to search in
- `ef` (string): Comma-separated list of extra fields to include

#### Example Queries

1. Search for providers in Bethesda:
```bash
curl -X POST http://localhost:3005/search_npi_providers \
  -H "Content-Type: application/json" \
  -d '{
    "terms": "john",
    "q": "addr_practice.city:Bethesda AND provider_type:Physician",
    "sf": "NPI,name.full,provider_type,addr_practice.city",
    "df": "NPI,name.full,provider_type,addr_practice"
  }'
```

2. Search for organizations with detailed address:
```bash
curl -X POST http://localhost:3005/search_npi_providers \
  -H "Content-Type: application/json" \
  -d '{
    "terms": "hospital",
    "q": "provider_type:Organization",
    "ef": "taxonomy,addr_practice",
    "df": "NPI,name.full,provider_type,addr_practice,taxonomy",
    "count": 2
  }'
```

### Medicare Provider Search

The `search_medicare_providers` tool provides access to Medicare Physician & Other Practitioners data for 2023. This data includes information about services and procedures provided to Original Medicare Part B beneficiaries. The tool supports two types of data:
- `geography_and_service`: Aggregated data by geographic area (National, State, County, or ZIP) showing total providers, services, and payments in each area
- `provider_and_service`: Individual provider-level data showing specific providers who performed services, their locations, and their service volumes

#### Parameters

- `dataset_type` (string, default: "geography_and_service"): Type of dataset to search. Options:
  - "geography_and_service": Aggregated data by geographic area
  - "provider_and_service": Individual provider-level data
- `hcpcs_code` (string): Healthcare Common Procedure Coding System (HCPCS) code
- `geo_level` (string): Geographic level of data ("National", "State", "County", "Zip") - only for geography_and_service dataset
- `geo_code` (string): Geographic code (state code, county code, or ZIP code) - only for geography_and_service dataset
- `place_of_service` (string): Place of service code ("F" for facility, "O" for office)
- `size` (number): Number of results to return (default: 10, max: 5000)
- `offset` (number): Starting result number for pagination (default: 0)
- `keyword` (string): Search term for quick full-text search across all fields
- `sort` (object): Sort results by field
  - `field`: Field to sort by (e.g., "Tot_Srvcs", "Avg_Mdcr_Pymt_Amt", "Rndrng_Prvdr_State_Abrvtn")
  - `direction`: Sort direction ("asc" or "desc")

#### Example Queries

1. Search for office visit codes by state (geography_and_service dataset):
```bash
curl -X POST http://localhost:3005/search_medicare_providers \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_type": "geography_and_service",
    "hcpcs_code": "99213",
    "geo_level": "State",
    "size": 2
  }'
```

2. Search for providers performing specific service (provider_and_service dataset):
```bash
curl -X POST http://localhost:3005/search_medicare_providers \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_type": "provider_and_service",
    "hcpcs_code": "99213",
    "size": 2
  }'
```

3. Search for provider by NPI (provider_and_service dataset):
```bash
curl -X POST http://localhost:3005/search_medicare_providers \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_type": "provider_and_service",
    "keyword": "1003000142",
    "size": 2
  }'
```

4. Search for providers by specialty (provider_and_service dataset):
```bash
curl -X POST http://localhost:3005/search_medicare_providers \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_type": "provider_and_service",
    "hcpcs_code": "99213",
    "keyword": "Neurology",
    "size": 2
  }'
```

## Usage

### HTTP Mode

To run the server in HTTP mode:

```bash
USE_HTTP=true PORT=3005 npm start
```

The server will be available at `http://localhost:3005` with the following endpoints:
- `POST /search_icd10cm_codes`
- `POST /search_npi_providers`
- `POST /search_medicare_providers`
- `GET /health` (health check endpoint)

### MCP Mode

To run the server in MCP mode:

```bash
npm start
```

The server will communicate via stdin/stdout using the Model Context Protocol.

## Notes

### ICD-10-CM Search
- Results are limited to 500 items per request
- The search is case-insensitive
- Multiple words in the search terms are ANDed together

### NPI Search
- Results are limited to 500 items per request
- The search is case-insensitive
- Multiple words in the search terms are ANDed together
- Provider types include: Physician, Organization, Individual, etc.

### Medicare Provider Search
- The data is from the 2023 Medicare Physician & Other Practitioners dataset
- Place of service codes: "F" for facility, "O" for office
- Drug indicator "Y" indicates the service involves a drug
- All monetary amounts are in USD
- Geographic codes follow standard state/county/ZIP code formats
- Results are limited to 5000 items per request

## Terms of Service

This server is provided as-is, without any warranty. The data is sourced from the National Library of Medicine and Centers for Medicare & Medicaid Services. Please refer to their respective terms of service for usage restrictions and requirements.