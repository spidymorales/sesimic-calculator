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

// Seismic API endpoint: uses 2% POE in 50 years (0.000404 per annum)
// as required for Sa(T,X) in NBC 2020 (4.1.8.4(1)(b))
app.post("/api/seismic", async (req, res) => {
  const { address, siteClass } = req.body;

  try {
    // Geocode address via Nominatim
    // Added error handling for failed fetch
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    let geoRes;
    try {
      geoRes = await fetch(geoUrl, {
        headers: { "User-Agent": "SeismicApp/1.0" }, // Good practice to set User-Agent
      });
      if (!geoRes.ok) {
           const geoErrorText = await geoRes.text();
           console.error("Nominatim Geocoding HTTP Error:", geoRes.status, geoErrorText);
           return res.status(geoRes.status).json({ error: `Geocoding failed: ${geoRes.statusText}` });
      }
    } catch (geoFetchErr) {
        console.error("Nominatim Geocoding Fetch Error:", geoFetchErr);
        return res.status(500).json({ error: `Failed to reach geocoding service: ${geoFetchErr.message}` });
    }


    const geoData = await geoRes.json();
    if (!Array.isArray(geoData) || geoData.length === 0) {
      return res.status(400).json({ error: "Address not found by geocoding service." });
    }
    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    // Query NRCAN GraphQL API for NBC 2020, Site Class Xs, 2%/50yr POE
    // Added sa0p5 to the query
    const query = {
      query: `
        query {
          NBC2020(latitude: ${lat}, longitude: ${lon}) {
            ${siteClass}: siteDesignationsXs(siteClass: ${siteClass}, poe50: [2.0]) {
              sa0p2
              sa0p5 # <--- ADDED sa0p5 HERE
              sa1p0
              # You could also add sa0p1, sa0p3, sa0p6, sa2p0, sa5p0, sa10p0 if needed later
            }
          }
        }
      `,
    };

    let graRes;
     try {
       graRes = await fetch(
         "https://www.earthquakescanada.nrcan.gc.ca/api/canshm/graphql",
         {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify(query),
         },
       );
        if (!graRes.ok) {
            const graErrorText = await graRes.text();
            console.error("NRCAN GraphQL HTTP Error:", graRes.status, graErrorText);
            return res.status(graRes.status).json({ error: `NRCAN API failed: ${graRes.statusText}` });
        }
     } catch (graFetchErr) {
         console.error("NRCAN GraphQL Fetch Error:", graFetchErr);
         return res.status(500).json({ error: `Failed to reach NRCAN API: ${graFetchErr.message}` });
     }


    const graData = await graRes.json();

    // Check for GraphQL errors within the response body
    if (graData.errors) {
      console.error("NRCAN GraphQL Response Errors:", graData.errors);
      // Return a more specific error if possible
      const errorMessage = graData.errors.map(err => err.message).join("; ");
      return res.status(500).json({ error: `NRCAN GraphQL errors: ${errorMessage}` });
    }

    // Access the data based on the siteClass key
    const hazardDataForSiteClass = graData.data && graData.data.NBC2020 && graData.data.NBC2020[siteClass];

    // Check if data for the specific site class and POE was found and has expected fields
    // Updated the check to include sa0p5
    if (!hazardDataForSiteClass || !Array.isArray(hazardDataForSiteClass) || hazardDataForSiteClass.length === 0 ||
        typeof hazardDataForSiteClass[0].sa0p2 === 'undefined' ||
        typeof hazardDataForSiteClass[0].sa0p5 === 'undefined' || // <--- CHECK FOR sa0p5 HERE
        typeof hazardDataForSiteClass[0].sa1p0 === 'undefined')
    {
      console.error("NRCAN GraphQL Response Data Structure Error:", graData);
      return res.status(500).json({ error: "NRCAN API response is missing required hazard data (sa0p2, sa0p5, sa1p0)." });
    }

    const hazard = hazardDataForSiteClass[0]; // Assuming the first result for 2.0% POE

    // Send the required data back to the frontend
    res.json({
      coords: { lat, lon },
      sa0p2: hazard.sa0p2,
      sa0p5: hazard.sa0p5, // <--- ADDED sa0p5 TO THE RESPONSE HERE
      sa1p0: hazard.sa1p0,
    });

  } catch (err) {
    // Catch any other unexpected errors during processing
    console.error("API Endpoint Internal Error:", err);
    res.status(500).json({ error: `An internal server error occurred: ${err.message}` });
  }
});

const PORT = process.env.PORT || 3000;
// bind to 0.0.0.0 so Render can detect it
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});