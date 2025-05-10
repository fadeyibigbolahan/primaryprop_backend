require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

app.get("/scheduled-task", (req, res) => {
  console.log("Scheduled task triggered!");
  // Run your task here, e.g., database cleanup, sending emails, etc.
  res.send("Task completed");
});

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.CLIENT_ID);
  params.append("client_secret", process.env.CLIENT_SECRET);
  params.append("scope", "api");

  const response = await axios.post(process.env.TOKEN_URL, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return response.data.access_token;
}

async function fetchListingsPage(token, skip = 0, top = 50) {
  const url = `${process.env.LISTINGS_URL}?$top=${top}&$skip=${skip}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Originating-System": process.env.ORIGINATING_SYSTEM,
    },
  });

  return response.data.value;
}

async function fetchMediaForKeys(token, numericKeys) {
  const mediaMap = {};
  const chunkSize = 50;

  for (let i = 0; i < numericKeys.length; i += chunkSize) {
    const chunk = numericKeys.slice(i, i + chunkSize);
    const filter = `ResourceRecordKeyNumeric in (${chunk.join(",")})`;

    const mediaRes = await axios.get(
      `https://api-trestle.corelogic.com/trestle/odata/Media?$filter=${filter}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            "application/json;odata.metadata=minimal;IEEE754Compatible=true",
          "Originating-System": process.env.ORIGINATING_SYSTEM,
        },
      }
    );

    mediaRes.data.value.forEach((m) => {
      const key = m.ResourceRecordKeyNumeric;
      if (!mediaMap[key]) mediaMap[key] = [];
      mediaMap[key].push(m.MediaURL);
    });
  }

  return mediaMap;
}

app.get("/api/listings", async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1");
    const perPage = 50;
    const skip = (page - 1) * perPage;

    const token = await getAccessToken();
    const listings = await fetchListingsPage(token, skip, perPage);

    const numericKeys = listings
      .map((l) => l.ListingKeyNumeric)
      .filter(Boolean);
    const mediaMap = await fetchMediaForKeys(token, numericKeys);

    const result = listings.map((l) => ({
      id: l.ListingId,
      key: l.ListingKeyNumeric,
      status: l.StandardStatus,
      price: l.ListPrice,
      type: l.PropertyType,
      address: l.UnparsedAddress,
      bedrooms: l.BedroomsTotal,
      bathrooms: l.BathroomsFull,
      area: l.LivingArea,
      images: mediaMap[l.ListingKeyNumeric] || [],
    }));

    res.json({ page, perPage, listings: result });
  } catch (error) {
    console.error(
      "Error fetching listings:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});

app.get("/api/listings/:id", async (req, res) => {
  try {
    const token = await getAccessToken();
    const id = req.params.id;

    // Filter listings server-side by ListingId
    const response = await axios.get(
      `${process.env.LISTINGS_URL}?$filter=ListingId eq '${id}'`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Originating-System": process.env.ORIGINATING_SYSTEM,
        },
      }
    );

    const listing = response.data.value[0];
    if (!listing) return res.status(404).json({ error: "Not found" });

    const mediaResponse = await axios.get(
      `https://api-trestle.corelogic.com/trestle/odata/Media?$filter=ResourceRecordKeyNumeric eq ${listing.ListingKeyNumeric}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            "application/json;odata.metadata=minimal;IEEE754Compatible=true",
          "Originating-System": process.env.ORIGINATING_SYSTEM,
        },
      }
    );

    const media = mediaResponse.data.value.map((m) => m.MediaURL);

    const result = {
      id: listing.ListingId,
      key: listing.ListingKeyNumeric,
      status: listing.StandardStatus,
      price: listing.ListPrice,
      type: listing.PropertyType,
      address: listing.UnparsedAddress,
      bedrooms: listing.BedroomsTotal,
      bathrooms: listing.BathroomsFull,
      area: listing.LivingArea,
      images: media,
    };

    res.json(result);
  } catch (error) {
    console.error(
      "Error fetching listing by ID:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch listing" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
