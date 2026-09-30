export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const importToken = String(process.env.FR_IMPORT_TOKEN || "").trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  const auth = req.headers?.authorization;
  const queryToken = req.query?.token;
  const bearer = typeof auth === "string"
    ? /^Bearer[ \t]+(.+)$/i.exec(auth.trim())
    : null;

  const token = bearer
    ? bearer[1].trim()
    : (!auth && typeof queryToken === "string" ? queryToken.trim() : "");

  function authError(status, code, message) {
    console.warn(JSON.stringify({
      event: "fr_import_auth",
      code,
      method: req.method
    }));

    return res.status(status).json({
      ok: false,
      error: message,
      code
    });
  }

  if (!importToken) {
    return authError(
      503,
      "FR_IMPORT_NOT_CONFIGURED",
      "FR_IMPORT_TOKEN fehlt im aktiven Deployment. In Vercel speichern und neu deployen."
    );
  }

  if (auth && !bearer) {
    return authError(
      401,
      "FR_AUTH_FORMAT",
      "Authorization muss Bearer verwenden. Im GPT API-Schluessel und Bearer auswaehlen."
    );
  }

  if (!token) {
    return authError(
      401,
      "FR_TOKEN_MISSING",
      "Kein Import-Schluessel gesendet. Schluessel in GPT oder FR-App speichern."
    );
  }

  if (token !== importToken) {
    return authError(
      401,
      "FR_TOKEN_MISMATCH",
      "Import-Schluessel stimmt nicht mit dem aktiven Vercel-Deployment ueberein."
    );
  }

  if (req.method === "GET" && req.query?.mode === "check") {
    return res.status(200).json({ok:true, version:2, message:"Import-Schlüssel gültig"});
  }

  if (!supabaseUrl || !supabaseSecret) {
    return res.status(500).json({
      ok: false,
      error: "Supabase config missing"
    });
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseSecret,
    Authorization: `Bearer ${supabaseSecret}`
  };

  if (req.method === "POST" && req.query?.mode === "ack") {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 ||
        !ids.every(id => /^(?:[0-9]+|[0-9a-fA-F-]{36})$/.test(String(id)))) {
      return res.status(400).json({ok:false,error:"Ungültige Import-IDs"});
    }
    try {
      const result = await fetch(`${supabaseUrl}/rest/v1/fr_imports?id=in.${encodeURIComponent('('+ids.join(',')+')')}`,
        {method:"DELETE",headers:{...headers,Prefer:"return=minimal"}});
      if (!result.ok) return res.status(502).json({ok:false,error:"Bestätigung fehlgeschlagen. Import bleibt zur Wiederholung verfügbar."});
      return res.status(200).json({ok:true});
    } catch (e) { return res.status(502).json({ok:false,error:"Bestätigung nicht erreichbar"}); }
  }

  if (req.method === "POST") {
    try {
      let document = req.body;

      // Regiestunden may identify the job by a name, site or address.
      // Leave Rechnung, Angebot and legacy Regiestunden payloads unchanged.
      if (document?.document_type === "Regiestunden") {
        document = { ...document };
        for (const field of ["name", "customer_name", "chef_name", "baustelle", "baustelle_adresse", "customer_address", "adresse", "datum", "arbeit_beschreibung_1", "arbeit_beschreibung_2", "bemerkung"]) {
          if (document[field] !== undefined && typeof document[field] !== "string") {
            return res.status(400).json({ok:false,error:`Ungültiger Text: ${field}`});
          }
        }
        for (const field of ["stunden_1", "stunden_2", "gesamt_stunden", "stunden_preis"]) {
          if (document[field] !== undefined && (typeof document[field] !== "number" || !Number.isFinite(document[field]) || document[field] < 0)) {
            return res.status(400).json({ok:false,error:`Ungültige Zahl: ${field}`});
          }
        }
        const name = [document.name, document.customer_name, document.chef_name]
          .find(value => typeof value === "string" && value.trim());
        const job = [document.baustelle, document.baustelle_adresse, document.customer_address, document.adresse]
          .find(value => typeof value === "string" && value.trim());
        if (!name && !job) {
          return res.status(400).json({ok:false,error:"Name, Baustelle oder Adresse fehlt"});
        }
        if (name && !document.customer_name?.trim()) {
          document.customer_name = name.trim();
        }
        for (const n of [1, 2]) {
          const description = document[`arbeit_beschreibung_${n}`];
          const hours = document[`stunden_${n}`];
          if ((description?.trim() && hours === undefined) ||
              (hours !== undefined && !description?.trim())) {
            return res.status(400).json({ok:false,error:`Beschreibung und Stunden für Position ${n} erforderlich`});
          }
        }
        const hasLineHours = document.stunden_1 !== undefined || document.stunden_2 !== undefined;
        if (hasLineHours) {
          const total = (document.stunden_1 ?? 0) + (document.stunden_2 ?? 0);
          if (!Number.isFinite(total)) {
            return res.status(400).json({ok:false,error:"Ungültige Gesamtstunden"});
          }
          if (document.gesamt_stunden !== undefined && Math.abs(document.gesamt_stunden - total) > 0.000001) {
            return res.status(400).json({ok:false,error:"gesamt_stunden stimmt nicht mit den Positionen überein"});
          }
          document.gesamt_stunden = document.gesamt_stunden ?? total;
        }
        if (document.gesamt_stunden !== undefined) {
          if (document.hours !== undefined && (typeof document.hours !== "number" || !Number.isFinite(document.hours) || Math.abs(document.hours - document.gesamt_stunden) > 0.000001)) {
            return res.status(400).json({ok:false,error:"hours stimmt nicht mit gesamt_stunden überein"});
          }
          document.hours = document.gesamt_stunden;
        }
      }

      if (!document || (document.document_type !== "Regiestunden" &&
          (typeof document.customer_name !== "string" || !document.customer_name.trim()))) {
        return res.status(400).json({
          ok: false,
          error: "customer_name fehlt"
        });
      }

      const documentType = document.document_type || "Rechnung";
      if (!["Rechnung", "Angebot", "Regiestunden"].includes(documentType)) {
        return res.status(400).json({ok:false,error:"Unbekannter Dokumenttyp"});
      }

      for (const field of ["wand_m2","wand_price","boden_m2","boden_price","hours","skonto","payment_days","material_cost"]) {
        if (document[field] !== undefined && (typeof document[field] !== "number" || !Number.isFinite(document[field]) || document[field] < 0)) {
          return res.status(400).json({ok:false,error:`Ungültige Zahl: ${field}`});
        }
      }
      if (document.steuer !== undefined && !["20","0","rc"].includes(document.steuer)) {
        return res.status(400).json({ok:false,error:"Ungültige Steuer"});
      }
      if (document.items !== undefined && (!Array.isArray(document.items) || !document.items.every(x=>x && typeof x.desc === "string" && typeof x.qty === "number" && Number.isFinite(x.qty) && x.qty >= 0 && typeof x.price === "number" && Number.isFinite(x.price) && x.price >= 0))) {
        return res.status(400).json({ok:false,error:"Ungültige Positionen"});
      }
      const savedDocument = {
        ...document,
        document_type: documentType
      };

      const response = await fetch(
        `${supabaseUrl}/rest/v1/fr_imports`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            invoice: savedDocument
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          error: data
        });
      }

      return res.status(200).json({
        ok: true,
        message: `FR ${documentType} zum Abruf bereit`,
        document_type: documentType,
        invoice: savedDocument
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  if (req.method === "GET") {
    try {
      const mode = req.query?.mode || "";

      if (mode === "clear") {
        const clear = await fetch(
          `${supabaseUrl}/rest/v1/fr_imports?id=gt.0`,
          {
            method: "DELETE",
            headers: {
              ...headers,
              Prefer: "return=minimal"
            }
          }
        );

        if (!clear.ok) {
          const err = await clear.text();

          return res.status(clear.status).json({
            ok: false,
            error: err
          });
        }

        return res.status(200).json({
          ok: true,
          cleared: true
        });
      }

      if (mode !== "pull") {
        return res.status(400).json({
          ok: false,
          error: "mode=pull or mode=clear required"
        });
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/fr_imports?select=id,created_at,invoice&order=created_at.asc`,
        {
          method: "GET",
          headers
        }
      );

      const rows = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          error: rows
        });
      }

      return res.status(200).json({
        ok: true,
        invoices: (rows || []).map(row => ({
          ...row.invoice,
          import_id: String(row.id),
          document_type:
            row.invoice?.document_type || "Rechnung",
          created_at: row.created_at
        }))
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  return res.status(405).json({
    ok: false,
    error: "Method not allowed"
  });
}
