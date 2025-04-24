const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from project root
app.use(express.static(__dirname));

// Serve index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Seismic API endpoint: uses 5% POE in 50 years
app.post("/api/seismic", async (req, res) => {
  const { address, siteClass } = req.body;

  try {
    // Geocode address via Nominatim
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    const geoRes = await fetch(geoUrl, {
      headers: { "User-Agent": "SeismicApp/1.0" },
    });
    const geoData = await geoRes.json();
    if (!Array.isArray(geoData) || geoData.length === 0) {
      return res.status(400).json({ error: "Address not found" });
    }
    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    // Query NRCAN GraphQL API with 5%/50yr (0.05) probability of exceedance
    const query = {
      query: `
        query {
          NBC2020(latitude: ${lat}, longitude: ${lon}) {
            ${siteClass}: siteDesignationsXs(siteClass: ${siteClass}, poe50: [2.0]) {
              sa0p2
              sa1p0
            }
          }
        }
      `,
    };

    const graRes = await fetch(
      "https://www.earthquakescanada.nrcan.gc.ca/api/canshm/graphql",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      },
    );

    const graData = await graRes.json();
    if (graData.errors) {
      return res.status(500).json({ error: "Seismic data fetch failed" });
    }

    const hazardArray = graData.data.NBC2020[siteClass];
    if (!Array.isArray(hazardArray) || hazardArray.length === 0) {
      return res.status(500).json({ error: "No seismic data available" });
    }
    const hazard = hazardArray[0];

    res.json({
      coords: { lat, lon },
      sa0p2: hazard.sa0p2,
      sa1p0: hazard.sa1p0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 3000;
// bind to 0.0.0.0 so Render can detect it
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
