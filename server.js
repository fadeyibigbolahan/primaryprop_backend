require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.CLIENT_ID);
  params.append("client_secret", process.env.CLIENT_SECRET);
  params.append("scope", "api");

  const response = await axios.post(process.env.TOKEN_URL, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data.access_token;
}

async function fetchAllListings(token, top = 100) {
  let allListings = [];
  let nextUrl = `${process.env.LISTINGS_URL}?$top=${top}`;

  while (nextUrl) {
    const response = await axios.get(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Originating-System": process.env.ORIGINATING_SYSTEM,
      },
    });

    const data = response.data;
    allListings = allListings.concat(data.value);

    nextUrl = data["@odata.nextLink"] || null;
  }

  return allListings;
}

app.get("/api/listings", async (req, res) => {
  try {
    const token = await getAccessToken();

    const listings = await fetchAllListings(token, 50); // 50 per page for efficiency

    const numericKeys = listings
      .map((l) => l.ListingKeyNumeric)
      .filter(Boolean);

    const chunks = [];
    const chunkSize = 50;

    for (let i = 0; i < numericKeys.length; i += chunkSize) {
      const chunk = numericKeys.slice(i, i + chunkSize);
      const mediaFilter = `ResourceRecordKeyNumeric in (${chunk.join(",")})`;

      const mediaResponse = await axios.get(
        `https://api-trestle.corelogic.com/trestle/odata/Media?$filter=${mediaFilter}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept:
              "application/json;odata.metadata=minimal;IEEE754Compatible=true",
            "Originating-System": process.env.ORIGINATING_SYSTEM,
          },
        }
      );

      chunks.push(...mediaResponse.data.value);
    }

    // Group media by ResourceRecordKeyNumeric
    const mediaMap = {};
    chunks.forEach((m) => {
      const key = m.ResourceRecordKeyNumeric;
      if (!mediaMap[key]) mediaMap[key] = [];
      mediaMap[key].push(m.MediaURL);
    });

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

    res.json(result);
  } catch (error) {
    console.error(
      "Error fetching listings:",
      error?.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
