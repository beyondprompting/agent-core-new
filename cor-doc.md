> ## Documentation Index
>
> Fetch the complete documentation index at: https://developers.projectcor.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Make your first COR API call in under 5 minutes

This guide walks you through authenticating with the COR API and making your first requests to manage projects, tasks, and time entries.

<Info>
  **Prerequisites**: Before you begin, make sure you have your API credentials ready. See the [Development guide](/development) to learn how to obtain your API Key and Client Secret from the COR dashboard.
</Info>

## Step 1: Get an access token

COR uses OAuth 2.0 for authentication. The **Client Credentials** flow is recommended for server-to-server integrations.

### Encode your credentials

First, create a Base64 encoded string of your API Key and Client Secret:

```bash theme={null}
echo -n "YOUR_API_KEY:YOUR_CLIENT_SECRET" | base64
```

This produces a string like: `WU9VUl9BUElfS0VZOllPVVJfQ0xJRU5UX1NFQ1JFVA==`

### Request the token

Use your encoded credentials to obtain an access token:

<CodeGroup>
  ```bash cURL theme={null}
  curl --location --request POST 'https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials' \
    --header 'Authorization: Basic YOUR_BASE64_CREDENTIALS'
  ```

```python Python theme={null}
import requests
import base64

api_key = "YOUR_API_KEY"
client_secret = "YOUR_CLIENT_SECRET"
credentials = base64.b64encode(f"{api_key}:{client_secret}".encode()).decode()

response = requests.post(
    'https://api.projectcor.com/v1/oauth/token',
    params={'grant_type': 'client_credentials'},
    headers={'Authorization': f'Basic {credentials}'}
)

token_data = response.json()
access_token = token_data['access_token']
print(f"Access token: {access_token}")
```

```javascript JavaScript theme={null}
const apiKey = "YOUR_API_KEY";
const clientSecret = "YOUR_CLIENT_SECRET";
const credentials = btoa(`${apiKey}:${clientSecret}`);

const response = await fetch(
  "https://api.projectcor.com/v1/oauth/token?grant_type=client_credentials",
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  },
);

const tokenData = await response.json();
console.log("Access token:", tokenData.access_token);
```

</CodeGroup>

**Success response:**

```json theme={null}
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4uLi4"
}
```

<Check>
  Save the `access_token` and `refresh_token`. You'll use the access token for all API calls.
</Check>

<Tip>
  Store your tokens securely using environment variables. Never hardcode them in your source code. See [secure token management](/development#secure-token-management) for best practices.
</Tip>

### Alternative authentication methods

<Accordion title="Authorization Code Flow">
  Best for applications that act on behalf of users with their consent.

**Step 1:** Redirect users to the consent screen:

```
https://YOUR_SUBDOMAIN.cor.works/oauth2/authorize?name=YourAppName&response_type=code&redirect_uri=YOUR_CALLBACK_URL
```

**Step 2:** Exchange the authorization code for a token:

```bash theme={null}
curl --location --request POST 'https://api.projectcor.com/v1/oauth2/token?grant_type=authorization_code&code=AUTH_CODE'
```

</Accordion>

<Accordion title="User Credentials Flow">
  For testing and development purposes only.

  <Warning>
    This method is not recommended for production applications.
  </Warning>

```bash theme={null}
curl --location 'https://api.projectcor.com/v1/auth/login' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=your@email.com' \
  --data-urlencode 'password=your_password'
```

</Accordion>

---

## Step 2: Verify your authentication

Test your access token by retrieving your user profile:

<CodeGroup>
  ```bash cURL theme={null}
  curl --location 'https://api.projectcor.com/v1/me' \
    --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'
  ```

```python Python theme={null}
import requests

headers = {'Authorization': f'Bearer {access_token}'}

response = requests.get('https://api.projectcor.com/v1/me', headers=headers)
user = response.json()
print(f"Logged in as: {user['first_name']} {user['last_name']}")
```

```javascript JavaScript theme={null}
const response = await fetch("https://api.projectcor.com/v1/me", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

const user = await response.json();
console.log(`Logged in as: ${user.first_name} ${user.last_name}`);
```

</CodeGroup>

**Success response:**

```json theme={null}
{
  "id": 12345,
  "first_name": "John",
  "last_name": "Doe",
  "email": "john.doe@company.com",
  "picture": "https://cdn.projectcor.com/avatars/12345.jpg",
  "role_id": 3,
  "user_position_id": 5,
  "daily_hours": 8,
  "remaining_hours": 6.5,
  "cuil": null,
  "labels": []
}
```

<Note>
  Role IDs: `1` (C-Level), `2` (Director), `3` (Project Manager), `4` (Collaborator), `5` (Freelancer), `6` (Client).
</Note>

<Check>
  If you see your user data, your authentication is working correctly.
</Check>

---

## Step 3: Explore core endpoints

Now that you're authenticated, here are the most common operations you'll perform with the COR API.

### List your projects

All list endpoints in COR return **paginated responses** by default. Use `page` and `perPage` parameters to navigate results, and `filters` to narrow down the data.

<CodeGroup>
  ```bash cURL theme={null}
  # Basic request (returns page 1 with 20 items)
  curl --location 'https://api.projectcor.com/v1/projects' \
    --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'

# With pagination

curl --location 'https://api.projectcor.com/v1/projects?page=1&perPage=10' \
 --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'

# With filters (URL-encoded JSON)

curl --location 'https://api.projectcor.com/v1/projects?page=1&filters=%7B%22client_id%22%3A25855%2C%22status%22%3A%22in_process%22%2C%22archived%22%3A2%7D' \
 --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'

````

```python Python theme={null}
import json

# Basic paginated request
response = requests.get(
    'https://api.projectcor.com/v1/projects',
    params={'page': 1, 'perPage': 10},
    headers=headers
)

result = response.json()
print(f"Total projects: {result['total']}")
print(f"Page {result['page']} of {result['lastPage']}")

for project in result['data']:
    print(f"- {project['name']} ({project['status']})")

# With filters
filters = json.dumps({
    "client_id": 25855,
    "status": "in_process",
    "archived": 2
})

response = requests.get(
    'https://api.projectcor.com/v1/projects',
    params={'page': 1, 'filters': filters},
    headers=headers
)
````

```javascript JavaScript theme={null}
// Basic paginated request
const response = await fetch(
  "https://api.projectcor.com/v1/projects?page=1&perPage=10",
  { headers: { Authorization: `Bearer ${accessToken}` } },
);

const result = await response.json();
console.log(`Total projects: ${result.total}`);
console.log(`Page ${result.page} of ${result.lastPage}`);

result.data.forEach((p) => console.log(`- ${p.name} (${p.status})`));

// With filters
const filters = JSON.stringify({
  client_id: 25855,
  status: "in_process",
  archived: 2,
});

const filtered = await fetch(
  `https://api.projectcor.com/v1/projects?page=1&filters=${encodeURIComponent(filters)}`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
```

</CodeGroup>

**Paginated response structure:**

```json theme={null}
{
  "total": "14",
  "perPage": 20,
  "page": 1,
  "lastPage": 1,
  "meta_data": {
    "profitability_limit": "30.00"
  },
  "data": [
    {
      "id": 155693,
      "name": "Website Redesign",
      "brief": "Complete website overhaul for Q1",
      "client_id": 25855,
      "health": 1,
      "status": "active",
      "start": "2025-01-15 00:00:00",
      "end": "2025-03-31 00:00:00",
      "estimated_time": 200,
      "elapsed_time": 45,
      "profitability_now": 85,
      "estimated_profitability": 100,
      "archived": false,
      "billable": true,
      "income_type": "fee",
      "pm_id": 8546,
      "created_at": "2025-01-10 14:30:00",
      "client": {
        "id": 25855,
        "name": "Acme Corp",
        "client_status_id": 1
      },
      "pm": {
        "id": 8546,
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@company.com",
        "role_id": 3
      }
    }
  ]
}
```

<Note>
  **Pagination parameters:**

- `page`: Page number (default: 1). Set to `false` to disable pagination and get all results.
- `perPage`: Items per page (default: 20).
  </Note>

<Accordion title="Available filter fields">
  | Field        | Type   | Description                                          |
  | ------------ | ------ | ---------------------------------------------------- |
  | `dateStart`  | string | Start date range (YYYY-MM-DD)                        |
  | `dateEnd`    | string | End date range (YYYY-MM-DD)                          |
  | `client_id`  | number | Filter by client ID                                  |
  | `team_id`    | number | Filter by team ID                                    |
  | `user_id`    | number | Filter by user/PM ID                                 |
  | `brand_id`   | number | Filter by brand ID                                   |
  | `product_id` | number | Filter by product ID                                 |
  | `status`     | string | `"finished"`, `"in_process"`, `"suspended"`          |
  | `health`     | number | 1 (on track), 2 (at risk), 3 (delayed), 4 (critical) |
  | `archived`   | number | `1` (archived only), `2` (active only)               |
</Accordion>

### List tasks for a project

Tasks are also paginated by default. Use the `filters` parameter with a JSON object to filter tasks by project:

<CodeGroup>
  ```bash cURL theme={null}
  curl --location 'https://api.projectcor.com/v1/tasks?page=1&filters=%7B%22project_id%22%3A5001%7D' \
    --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'
  ```

```python Python theme={null}
import json

filters = json.dumps({"project_id": 5001})

response = requests.get(
    'https://api.projectcor.com/v1/tasks',
    params={'page': 1, 'filters': filters},
    headers=headers
)

result = response.json()
print(f"Total tasks: {result['total']}")

for task in result['data']:
    print(f"- [{task['status']}] {task['title']}")
```

```javascript JavaScript theme={null}
const filters = JSON.stringify({ project_id: 5001 });

const response = await fetch(
  `https://api.projectcor.com/v1/tasks?page=1&filters=${encodeURIComponent(filters)}`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);

const result = await response.json();
console.log(`Total tasks: ${result.total}`);

result.data.forEach((t) => console.log(`- [${t.status}] ${t.title}`));
```

</CodeGroup>

<Tip>
  The `filters` parameter accepts a URL-encoded JSON object. You can filter by multiple fields like `project_id`, `status`, `user_id`, and more.
</Tip>

**Paginated response structure:**

```json theme={null}
{
  "total": "25",
  "perPage": 20,
  "page": 1,
  "lastPage": 2,
  "data": [
    {
      "id": 10001,
      "title": "Design homepage mockup",
      "project_id": 5001,
      "description": "Create wireframes and high-fidelity mockups for the new homepage",
      "status": "finalizada",
      "priority": 2,
      "deadline": "2024-01-15T18:00:00Z",
      "archived": false
    },
    {
      "id": 10002,
      "title": "Implement responsive navigation",
      "project_id": 5001,
      "description": "Build mobile-first navigation component with hamburger menu",
      "status": "en_proceso",
      "priority": 1,
      "deadline": "2024-01-22T18:00:00Z",
      "archived": false
    }
  ]
}
```

<Note>
  Task status values: `nueva` (new), `en_proceso` (in progress), `estancada` (stalled), `finalizada` (completed).\
  Priority values: `0` (low), `1` (medium), `2` (high), `3` (urgent).
</Note>

### Log time to a task

Time entries use `start` and `stop` timestamps to track worked hours:

<CodeGroup>
  ```bash cURL theme={null}
  curl --location 'https://api.projectcor.com/v1/hours' \
    --header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "task_log_id": 10002,
      "start": "2024-01-18T09:00:00Z",
      "stop": "2024-01-18T11:30:00Z"
    }'
  ```

```python Python theme={null}
response = requests.post(
    'https://api.projectcor.com/v1/hours',
    headers={**headers, 'Content-Type': 'application/json'},
    json={
        'task_log_id': 10002,
        'start': '2024-01-18T09:00:00Z',
        'stop': '2024-01-18T11:30:00Z'
    }
)

print(f"Time entry created: {response.json()}")
```

```javascript JavaScript theme={null}
const response = await fetch("https://api.projectcor.com/v1/hours", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    task_log_id: 10002,
    start: "2024-01-18T09:00:00Z",
    stop: "2024-01-18T11:30:00Z",
  }),
});

const entry = await response.json();
console.log("Time entry created:", entry);
```

</CodeGroup>

**Success response:**

```json theme={null}
{
  "id": 50001,
  "task_log_id": 10002,
  "start": "2024-01-18T09:00:00Z",
  "stop": "2024-01-18T11:30:00Z",
  "status": "pending"
}
```

<Tip>
  The `stop` field is optional. If omitted, a timer will start for the task that you can stop later.
</Tip>

### Get your clients

Clients are also paginated by default:

<CodeGroup>
  ```bash cURL theme={null}
  curl --location 'https://api.projectcor.com/v1/clients?page=1' \
    --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'
  ```

```python Python theme={null}
response = requests.get(
    'https://api.projectcor.com/v1/clients',
    params={'page': 1},
    headers=headers
)

result = response.json()
print(f"Total clients: {result['total']}")

for client in result['data']:
    print(f"- {client['name']} (ID: {client['id']})")
```

```javascript JavaScript theme={null}
const response = await fetch("https://api.projectcor.com/v1/clients?page=1", {
  headers: { Authorization: `Bearer ${accessToken}` },
});

const result = await response.json();
console.log(`Total clients: ${result.total}`);

result.data.forEach((c) => console.log(`- ${c.name} (ID: ${c.id})`));
```

</CodeGroup>

**Paginated response structure:**

```json theme={null}
{
  "total": "45",
  "perPage": 20,
  "page": 1,
  "lastPage": 3,
  "data": [
    {
      "id": 2001,
      "name": "Acme Corp",
      "business_name": "Acme Corporation LLC",
      "name_contact": "Jane",
      "last_name_contact": "Smith",
      "email_contact": "jane.smith@acme.com",
      "phone": "+1 555-0100",
      "website": "https://acme.com",
      "description": "Enterprise software solutions",
      "condition": "active"
    },
    {
      "id": 2002,
      "name": "TechStart Inc",
      "business_name": "TechStart Incorporated",
      "name_contact": "Mike",
      "last_name_contact": "Johnson",
      "email_contact": "mike@techstart.io",
      "phone": "+1 555-0200",
      "website": "https://techstart.io",
      "description": "Startup accelerator",
      "condition": "active"
    }
  ]
}
```

---

## Step 4: Refresh your token

Access tokens expire after the time specified in `expires_in` (typically 1 hour). Use the refresh token to obtain a new access token:

```bash theme={null}
curl --location 'https://api.projectcor.com/v1/oauth/refreshtoken' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'refresh_token=YOUR_REFRESH_TOKEN'
```

**Success response:**

```json theme={null}
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.newtoken...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "bmV3IHJlZnJlc2ggdG9rZW4uLi4"
}
```

<Tip>
  For production applications, implement automatic token refresh to ensure uninterrupted API access. See the [Development guide](/development#implement-automatic-token-refresh) for a complete implementation example.
</Tip>

---

## Handle errors

When something goes wrong, the API returns standard HTTP status codes:

| Code  | Description       | Solution                                 |
| ----- | ----------------- | ---------------------------------------- |
| `400` | Bad Request       | Check required fields and JSON syntax    |
| `401` | Unauthorized      | Refresh or re-obtain access token        |
| `403` | Forbidden         | Request necessary permissions from admin |
| `404` | Not Found         | Verify resource ID exists                |
| `429` | Too Many Requests | Implement backoff and retry              |
| `500` | Server Error      | Retry with exponential backoff           |

<AccordionGroup>
  <Accordion title="401 Unauthorized - Token issues">
    **Common causes:**

    * Access token has expired
    * Token not included in Authorization header
    * Token format is incorrect (missing "Bearer " prefix)

    **Solutions:**

    1. Verify header format: `Authorization: Bearer YOUR_TOKEN`
    2. Refresh the token using `/oauth/refreshtoken`
    3. Re-authenticate if refresh token is also expired

  </Accordion>

  <Accordion title="400 Bad Request - Invalid data">
    **Common causes:**

    * Missing required fields in request body
    * Invalid date format (use `YYYY-MM-DD`)
    * Malformed JSON

    **Solutions:**

    1. Check the [API Reference](/api-reference/introduction) for required parameters
    2. Validate JSON syntax before sending
    3. Ensure dates use ISO 8601 format

  </Accordion>

  <Accordion title="503 Service Unavailable">
    **Common causes:**

    * Temporary service disruption
    * High API traffic

    **Solutions:**

    1. Wait 5 minutes and retry
    2. Implement exponential backoff in your integration
    3. Check [COR Status](https://cor.zendesk.com/) for known issues

  </Accordion>
</AccordionGroup>

---

## Next steps

Congratulations! You've successfully authenticated and made your first API calls. Here's where to go next:

<CardGroup cols={2}>
  <Card title="Development Guide" icon="code" href="/development">
    Set up your development environment with best practices for token management, error handling, and pagination.
  </Card>

  <Card title="API Reference" icon="book" href="/api-reference/introduction">
    Explore all available endpoints with detailed parameters and response schemas.
  </Card>

  <Card title="Projects API" icon="folder-open" href="/api-reference/projects/list">
    Create, update, and manage projects with budgets, timelines, and team assignments.
  </Card>

  <Card title="Tasks API" icon="list-check" href="/api-reference/tasks/list">
    Manage tasks, track progress, and handle assignments across your projects.
  </Card>

  <Card title="Time Tracking API" icon="clock" href="/api-reference/hours/list">
    Log hours, manage time entries, and generate reports for billing.
  </Card>

  <Card title="Resource Allocation" icon="calendar-check" href="/api-reference/resource-allocation-introduction">
    Plan team capacity, allocate users to projects, and manage workload distribution.
  </Card>

  <Card title="Integrations API" icon="plug" href="/api-reference/integrations-introduction">
    Connect external systems like Salesforce, Jira, and SAP with bidirectional sync.
  </Card>
</CardGroup>

<Note>
  **Need help?** Contact our support team at [help@projectcor.com](mailto:help@projectcor.com) or visit [COR Support](https://cor.zendesk.com/).
</Note>

> ## Documentation Index
>
> Fetch the complete documentation index at: https://developers.projectcor.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Development

> Set up your development environment and build integrations with the COR API

This guide helps you configure your development environment, obtain API credentials, and implement best practices for building robust integrations with COR.

## Get your API credentials

Before you can make API requests, you need to obtain your API Key and Client Secret from the COR dashboard.

<Steps>
  <Step title="Access API settings">
    Log in to your COR account and navigate to **Settings** > **Integrations** > **API**.
  </Step>

  <Step title="Generate credentials">
    Click **Generate API Key** to create a new API Key and Client Secret pair.

    <Frame caption="API Key settings in the COR dashboard">
      <img src="https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=88c1361056d814b4a83a0d24beda6164" alt="COR API Key settings page showing where to generate and manage API credentials" data-og-width="2298" width="2298" data-og-height="800" height="800" data-path="images/API Key.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=280&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=d46d39ff5ffaae9540522e34d27c105c 280w, https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=560&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=4d81382d7756340409e81868117b3dcc 560w, https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=840&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=047890562c8bb294b35015b7c904e959 840w, https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=1100&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=ba1b28de778d72728186270a469666ff 1100w, https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=1650&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=8ad15f89835544276ce68614c417292c 1650w, https://mintcdn.com/cor/RB0qoHJHFBU632dP/images/API%20Key.png?w=2500&fit=max&auto=format&n=RB0qoHJHFBU632dP&q=85&s=d3573a769ab401c22fecf4aa075d2582 2500w" />
    </Frame>

    <Warning>
      Store your Client Secret securely. It is only displayed once during creation. If you lose it, you must generate new credentials.
    </Warning>

  </Step>

  <Step title="Encode credentials for authentication">
    For Client Credentials authentication, encode your credentials in Base64:

    ```bash  theme={null}
    echo -n "YOUR_API_KEY:YOUR_CLIENT_SECRET" | base64
    ```

    This produces a string like `WU9VUl9BUElfS0VZOllPVVJfQ0xJRU5UX1NFQ1JFVA==` that you use in the Authorization header.

  </Step>
</Steps>

## API environments

COR provides three API services that work together to manage your projects, resources, and external integrations.

<CardGroup cols={2}>
  <Card title="COR API" icon="server">
    **Base URL:** `https://api.projectcor.com/v1`

    Main API for projects, tasks, clients, users, time tracking, and transactions.

  </Card>

  <Card title="Resource Allocation API" icon="calendar-check">
    **Base URL:** `https://planner.svc.v2.projectcor.com`

    Dedicated service for managing user capacity and project allocations.

  </Card>
</CardGroup>

<CardGroup cols={2}>
  <Card title="Integrations API" icon="plug">
    **Base URL:** `https://integrations.projectcor.com/`

    Service for external system integrations with external ID mapping and bidirectional sync.

  </Card>
</CardGroup>

<Note>
  All three APIs share the same authentication. Use your access token from the main COR API to authenticate requests to the Resource Allocation API and Integrations API.
</Note>

## Development tools

### Import the OpenAPI specification

Import the COR OpenAPI specification into your preferred API client for easy testing:

<Tabs>
  <Tab title="Postman">
    1. Open Postman and click **Import**
    2. Select **Link** and paste the OpenAPI URL:

    ```
    https://developers.projectcor.com/api-reference/openapi.json
    ```

    3. Click **Import** to generate a complete collection with all endpoints

  </Tab>

  <Tab title="Insomnia">
    1. Go to **Application** > **Preferences** > **Data**
    2. Click **Import Data** > **From URL**
    3. Enter the OpenAPI URL:

    ```
    https://developers.projectcor.com/api-reference/openapi.json
    ```

  </Tab>

  <Tab title="VS Code">
    Install the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension and create `.http` files:

    ```http  theme={null}
    @baseUrl = https://api.projectcor.com/v1
    @token = YOUR_ACCESS_TOKEN

    ### Get authenticated user
    GET {{baseUrl}}/me
    Authorization: Bearer {{token}}

    ### Get projects
    GET {{baseUrl}}/projects
    Authorization: Bearer {{token}}
    ```

  </Tab>
</Tabs>

### Recommended libraries

Use these HTTP libraries for your integrations:

<CodeGroup>
  ```python Python theme={null}
  # Install: pip install requests
  import requests

headers = {
'Authorization': f'Bearer {access_token}',
'Content-Type': 'application/json'
}

# All list endpoints return paginated responses

response = requests.get(
'https://api.projectcor.com/v1/projects',
params={'page': 1},
headers=headers
)
result = response.json()

# Access paginated data

print(f"Total: {result['total']}, Page: {result['page']}/{result['lastPage']}")
for project in result['data']:
print(project['name'])

````

```javascript JavaScript (Node.js) theme={null}
// Install: npm install axios
const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.projectcor.com/v1',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});

// All list endpoints return paginated responses
const response = await client.get('/projects', { params: { page: 1 } });
const { total, page, lastPage, data } = response.data;

console.log(`Total: ${total}, Page: ${page}/${lastPage}`);
data.forEach(project => console.log(project.name));
````

```php PHP theme={null}
// Install: composer require guzzlehttp/guzzle
use GuzzleHttp\Client;

$client = new Client([
    'base_uri' => 'https://api.projectcor.com/v1/',
    'headers' => [
        'Authorization' => 'Bearer ' . $accessToken,
        'Content-Type' => 'application/json'
    ]
]);

// All list endpoints return paginated responses
$response = $client->get('projects', ['query' => ['page' => 1]]);
$result = json_decode($response->getBody(), true);

echo "Total: {$result['total']}, Page: {$result['page']}/{$result['lastPage']}\n";
foreach ($result['data'] as $project) {
    echo $project['name'] . "\n";
}
```

```go Go theme={null}
package main

import (
    "encoding/json"
    "net/http"
)

type PaginatedResponse struct {
    Total    string        `json:"total"`
    PerPage  int           `json:"perPage"`
    Page     int           `json:"page"`
    LastPage int           `json:"lastPage"`
    Data     []interface{} `json:"data"`
}

func main() {
    client := &http.Client{}
    // All list endpoints return paginated responses
    req, _ := http.NewRequest("GET",
        "https://api.projectcor.com/v1/projects?page=1", nil)
    req.Header.Set("Authorization", "Bearer "+accessToken)
    req.Header.Set("Content-Type", "application/json")

    resp, _ := client.Do(req)
    defer resp.Body.Close()

    var result PaginatedResponse
    json.NewDecoder(resp.Body).Decode(&result)
}
```

</CodeGroup>

## Best practices

### Secure token management

<Warning>
  Never hardcode API credentials or tokens in your source code. Use environment variables or a secure secrets manager.
</Warning>

```bash theme={null}
# Set environment variables
export COR_API_KEY="your_api_key"
export COR_CLIENT_SECRET="your_client_secret"
```

```python theme={null}
import os

api_key = os.environ.get('COR_API_KEY')
client_secret = os.environ.get('COR_CLIENT_SECRET')
```

### Implement automatic token refresh

Access tokens expire after a period of time. Implement automatic refresh to maintain uninterrupted access:

```javascript theme={null}
class CORClient {
  constructor(apiKey, clientSecret) {
    this.apiKey = apiKey;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  async ensureValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.refreshAccessToken();
    }
  }

  async refreshAccessToken() {
    if (this.refreshToken) {
      const response = await fetch(
        "https://api.projectcor.com/v1/oauth/refreshtoken",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `refresh_token=${this.refreshToken}`,
        },
      );
      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      this.tokenExpiry = Date.now() + data.expires_in * 1000;
    } else {
      await this.authenticate();
    }
  }

  async request(endpoint, options = {}) {
    await this.ensureValidToken();
    return fetch(`https://api.projectcor.com/v1${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }
}
```

### Handle pagination

All list endpoints return **paginated responses** by default with the following structure:

```json theme={null}
{
  "total": "100",
  "perPage": 20,
  "page": 1,
  "lastPage": 5,
  "data": [...]
}
```

Use the `page` and `perPage` parameters to navigate through results:

<CodeGroup>
  ```python Python theme={null}
  def get_all_projects(access_token):
      """Fetch all projects across all pages."""
      all_projects = []
      page = 1
      
      while True:
          response = requests.get(
              'https://api.projectcor.com/v1/projects',
              params={'page': page, 'perPage': 50},
              headers={'Authorization': f'Bearer {access_token}'}
          )
          result = response.json()
          
          # Add projects from current page
          all_projects.extend(result['data'])
          
          # Check if we've reached the last page
          if page >= result['lastPage']:
              break
              
          page += 1
      
      return all_projects
  ```

```javascript JavaScript theme={null}
async function getAllProjects(accessToken) {
  const allProjects = [];
  let page = 1;
  let lastPage = 1;

  do {
    const response = await fetch(
      `https://api.projectcor.com/v1/projects?page=${page}&perPage=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const result = await response.json();

    allProjects.push(...result.data);
    lastPage = result.lastPage;
    page++;
  } while (page <= lastPage);

  return allProjects;
}
```

</CodeGroup>

<Tip>
  By default, list endpoints return 20 items per page. You can increase this up to 50 with the `perPage` parameter to reduce the number of requests. Set `page=false` to disable pagination entirely (use with caution on large datasets).
</Tip>

## Error handling

### HTTP status codes

The COR API uses standard HTTP status codes:

| Code  | Description          | Action                              |
| ----- | -------------------- | ----------------------------------- |
| `200` | Success              | Process the response                |
| `204` | Success (No Content) | Request succeeded, no body returned |
| `400` | Bad Request          | Check request parameters and body   |
| `401` | Unauthorized         | Refresh or re-obtain access token   |
| `404` | Not Found            | Verify the resource ID exists       |
| `429` | Too Many Requests    | Implement backoff and retry         |
| `500` | Server Error         | Retry with exponential backoff      |

### Implement retry logic

Handle transient errors with exponential backoff:

```python theme={null}
import time
import requests

def request_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            return response.json()

        if response.status_code in [429, 500, 502, 503, 504]:
            wait_time = (2 ** attempt) + 1  # 1s, 3s, 5s
            print(f"Retry {attempt + 1}/{max_retries} after {wait_time}s")
            time.sleep(wait_time)
            continue

        # Non-retryable error
        response.raise_for_status()

    raise Exception(f"Max retries exceeded for {url}")
```

## Troubleshooting

<AccordionGroup>
  <Accordion title="401 Unauthorized - Invalid or expired token">
    **Causes:**

    * Access token has expired
    * Token was not included in the request
    * Token format is incorrect

    **Solutions:**

    1. Verify the token is included: `Authorization: Bearer YOUR_TOKEN`
    2. Refresh the token using the `/oauth/refreshtoken` endpoint
    3. Re-authenticate to obtain a new token pair

  </Accordion>

  <Accordion title="400 Bad Request - Invalid request format">
    **Causes:**

    * Missing required fields in the request body
    * Invalid data types or formats
    * Malformed JSON

    **Solutions:**

    1. Check the API reference for required parameters
    2. Validate JSON syntax before sending
    3. Ensure dates are in the correct format (`YYYY-MM-DD`)

  </Accordion>

  <Accordion title="403 Forbidden - Insufficient permissions">
    **Causes:**

    * User lacks permission for the requested action
    * API key scope is limited

    **Solutions:**

    1. Verify your user has the required permissions in COR
    2. Contact your COR administrator to adjust permissions

  </Accordion>

  <Accordion title="503 Service Unavailable - Temporary outage">
    **Causes:**

    * High API traffic
    * Scheduled maintenance

    **Solutions:**

    1. Wait 5 minutes and retry
    2. Implement exponential backoff in your integration
    3. Check [COR Status](https://cor.zendesk.com/) for known issues

  </Accordion>
</AccordionGroup>

## Next steps

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    Make your first API call and authenticate with COR.
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference/introduction">
    Explore all available endpoints and parameters.
  </Card>

  <Card title="Resource Allocation" icon="users" href="/api-reference/resource-allocation-introduction">
    Manage user capacity and project assignments.
  </Card>

  <Card title="AI Tools" icon="wand-magic-sparkles" href="/ai-tools/cursor">
    Use AI-powered tools to accelerate your integration development.
  </Card>
</CardGroup>

<Note>
  **Need help?** Contact our support team at [help@projectcor.com](mailto:help@projectcor.com) or visit [COR Support](https://cor.zendesk.com/).
</Note>
