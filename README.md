# ICD-10-CM MCP Server

A lightweight server that exposes the National Library of Medicine's ICD-10-CM code search API via the Model Context Protocol (MCP) and HTTP. This service allows you to search for ICD-10-CM codes by code or diagnosis name, making it easy to integrate medical code lookup into your applications or workflows.

## What is ICD-10-CM?
ICD-10-CM (International Classification of Diseases, 10th Revision, Clinical Modification) is a medical coding system for classifying diagnoses and reasons for visits in U.S. health care settings.

- **Current version:** ICD-10-CM 2025
- **Data version:** 2025; 74,260 records
- **More info:** [CDC ICD-10-CM](https://www.cdc.gov/nchs/icd/icd10cm.htm)

## About this Server
- **Project:** `icd-mcp-server`
- **Version:** 0.1
- **Author:** Joan Saez-Pons
- **License:** MIT

This server provides a bridge between the Model Context Protocol (MCP) and the NLM ICD-10-CM API. It supports both MCP (stdio) and HTTP server modes for flexible integration.

## API Used
- **Base URL:** `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search`
- **Official docs:** [NLM Clinical Tables API](https://clinicaltables.nlm.nih.gov/apidoc/icd10cm/v3/doc.html)

### Query Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `terms`   |         | **Required.** The search string (e.g., part of a word/code) to match. Multiple words are ANDed. |
| `maxList` | 500     | Optional. Max number of results. |
| `count`   | 500     | Number of results to retrieve (page size). |
| `offset`  | 0       | Starting result number (for pagination). |
| `sf`      | code    | Comma-separated list of fields to search. |
| `q`       |         | Optional. Additional query string to further constrain results. Supports wildcards and field names. |
| `df`      | code,name | Comma-separated list of display fields. |

### Output Format
The API returns an array:
1. Total number of results on the server (may be capped at 10,000)
2. Array of codes for the returned items
3. Hash of extra data (if requested)
4. Array of display data (e.g., `[code, name]` for each result)

Example response:
```
[
  71,
  ["A15.0","A15.4",...],
  null,
  [["A15.0","Tuberculosis of lung"], ...]
]
```

## Example Queries
- Search for tuberculosis-related codes:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=tuberc`
- Search for codes starting with A15:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=A15`
- Search for tuberculosis-related codes with additional constraint:
  - `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code,name&terms=tuberc&q=code:A15*`

## Using This Server

### HTTP Mode
- Start the server with `USE_HTTP=true` in your environment.
- POST to `/search_icd10cm_codes` with JSON body:
  ```json
  { "terms": "tuberc", "maxList": 500 }
  ```
- Response:
  ```json
  {
    "total": 71,
    "codes": [
      { "code": "A15.0", "name": "Tuberculosis of lung" },
      ...
    ]
  }
  ```

### MCP (Stdio) Mode
- Default mode. Use an MCP client to call the `search_icd10cm_codes` tool.
- Example MCP request:
  ```json
  {
    "tool": "search_icd10cm_codes",
    "arguments": { "terms": "tuberc", "maxList": 500 }
  }
  ```

## Terms of Service
This service is provided "as is" and free of charge. See the [NLM FAQ](https://clinicaltables.nlm.nih.gov/faq.html) for more details.

## License
MIT

## Extra Fields (ef)

The API supports an optional `ef` parameter to request additional fields in the response. Available extra fields include:

- **excludes**: Lists conditions or codes that are excluded from the current code.
- **includes**: Lists conditions or codes that are included under the current code.
- **notes**: Additional notes or instructions related to the code.
- **category**: The category or chapter the code belongs to.
- **subcategory**: A more specific subcategory of the code.
- **parent**: The parent code or category.
- **block**: The block or range the code belongs to.
- **chapter**: The chapter number or name in the ICD-10-CM classification.

**Note:** Not all extra fields are populated for all codes. If a field is not available, it will be returned as `null`.

### Example Request with Extra Fields

```sh
curl -s -X POST http://localhost:3005/search_icd10cm_codes \
  -H 'Content-Type: application/json' \
  -d '{"terms": "tuberc", "ef": "excludes,includes,notes"}' | jq
```

### Example Response

```json
{
  "total": 78,
  "codes": [
    {
      "code": "A15.0",
      "name": "Tuberculosis of lung",
      "excludes": null,
      "includes": null,
      "notes": null
    },
    ...
  ]
}
```