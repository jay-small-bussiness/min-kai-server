# Solo Google Play Billing

## Product

- Store: `google_play`
- Product ID: `min_kai_solo_monthly`
- Base plan ID: `monthly-auto`
- Billing type: auto-renewing subscription
- Billing period: monthly
- Price: JPY 100
- Region: Japan

## Server environment

Set these values in the production server environment. Do not commit the service
account JSON file.

```text
GOOGLE_PLAY_PACKAGE_NAME=com.business.small.jay.shoppinglist002
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=<min-kai-play-billing-a1d4a615b3ac.json full JSON>
```

Alternative split variables:

```text
GOOGLE_PLAY_CLIENT_EMAIL=<service account client_email>
GOOGLE_PLAY_PRIVATE_KEY=<service account private_key>
```

## Purchase sync API

After Google Play Billing returns a successful subscription purchase, the client
sends the purchase token to the server.

```http
POST /api/billing/purchases/sync
Content-Type: application/json
```

```json
{
  "user_id": "00000000-0000-0000-0000-000000000000",
  "store": "google_play",
  "product_id": "min_kai_solo_monthly",
  "base_plan_id": "monthly-auto",
  "purchase_token": "<purchase token from Google Play Billing>"
}
```

The server verifies the token with Google Play Developer API
`purchases.subscriptionsv2.get`. Only a token that matches
`min_kai_solo_monthly` and `monthly-auto` can update the account to Solo.

## Account update rule

- Active or grace-period subscription with a future expiry:
  - `accounts.plan_type = solo`
  - `accounts.status = active` or `cancel_scheduled`
  - `accounts.expires_at = lineItems[].expiryTime`
- Expired or unusable subscription:
  - `accounts.plan_type = free`
  - `accounts.status = expired`
  - `accounts.expires_at = lineItems[].expiryTime`

Purchase tokens are not stored directly. The server stores only a SHA-256 hash
and the last four characters in `billing_purchases`.
