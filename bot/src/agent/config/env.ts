import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(__dirname, "../../../.env"), override: true });

export function getCleanBackendUrl(): string {
  const raw = (process.env.BACKEND_URL || "http://localhost:4000").trim();
  return raw.replace(/\/api\/v1\/?$/i, "").replace(/\/+$/, "");
}

export function getBackendApiKey(): string {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
  dotenv.config({ path: path.join(__dirname, "../../../.env"), override: true });

  let key = (
    process.env.BACKEND_API_KEY ||
    process.env.SYSTEM_ADMIN_API_KEY ||
    process.env.EXTERNAL_SERVICE_API_KEY ||
    ""
  ).trim();

  if (!key) {
    try {
      const envPaths = [
        path.resolve(process.cwd(), ".env"),
        path.join(__dirname, "../../../.env"),
        "/var/www/wsp/.env"
      ];
      for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, "utf8");
          const match = content.match(/BACKEND_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) {
            key = match[1].trim();
            process.env.BACKEND_API_KEY = key;
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return key;
}

export function getGeminiApiKey(): string {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
  dotenv.config({ path: path.join(__dirname, "../../../.env"), override: true });
  dotenv.config({ path: "/var/www/wsp/.env", override: true });

  let key = (process.env.GEMINI_API_KEY || "").trim();

  if (!key) {
    try {
      const envPaths = [
        path.resolve(process.cwd(), ".env"),
        path.join(__dirname, "../../../.env"),
        path.join(__dirname, "../../../../.env"),
        "/var/www/wsp/.env",
        "/var/www/wsp/bot/.env"
      ];
      for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, "utf8");
          const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) {
            key = match[1].trim();
            process.env.GEMINI_API_KEY = key;
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return key;
}

export function inferStateFromCity(city?: string, currentState?: string): string {
  if (currentState && currentState.trim()) return currentState.trim();
  if (!city || !city.trim()) return "";

  const norm = (str: string) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  const c = norm(city);

  if (
    c.includes("concordia") ||
    c.includes("parana") ||
    c.includes("gualeguaychu") ||
    c.includes("gualeguay") ||
    c.includes("chajari") ||
    c.includes("federacion") ||
    c.includes("villaguay") ||
    c.includes("concepcion del uruguay") ||
    c.includes("victoria") ||
    c.includes("santa elena") ||
    c.includes("la paz") ||
    c.includes("diamante") ||
    c.includes("colon") ||
    c.includes("san jose") ||
    c.includes("crespo") ||
    c.includes("nogoya") ||
    c.includes("federal") ||
    c.includes("basavilbaso")
  ) {
    return "Entre Ríos";
  }

  if (
    c.includes("santa fe") ||
    c.includes("rosario") ||
    c.includes("venado tuerto") ||
    c.includes("rafaela") ||
    c.includes("reconquista") ||
    c.includes("santo tome") ||
    c.includes("esperanza") ||
    c.includes("san lorenzo") ||
    c.includes("villa constitucion") ||
    c.includes("galvez") ||
    c.includes("casilda") ||
    c.includes("canonada de gomez") ||
    c.includes("san javier") ||
    c.includes("coronda") ||
    c.includes("san cristobal")
  ) {
    return "Santa Fe";
  }

  if (
    c.includes("corrientes") ||
    c.includes("goya") ||
    c.includes("paso de los libres") ||
    c.includes("curuzu cuatia") ||
    c.includes("mercedes") ||
    c.includes("bellavista") ||
    c.includes("bella vista") ||
    c.includes("ituzaingo") ||
    c.includes("esquina") ||
    c.includes("monte caseros") ||
    c.includes("santo tome corrientes")
  ) {
    return "Corrientes";
  }

  if (
    c.includes("resistencia") ||
    c.includes("saenz pena") ||
    c.includes("charata") ||
    c.includes("castelli") ||
    c.includes("villa angela") ||
    c.includes("fontana") ||
    c.includes("barranqueras")
  ) {
    return "Chaco";
  }

  if (
    c.includes("cordoba") ||
    c.includes("rio cuarto") ||
    c.includes("villa maria") ||
    c.includes("carlos paz") ||
    c.includes("san francisco") ||
    c.includes("alta gracia") ||
    c.includes("bell ville") ||
    c.includes("rio tercero")
  ) {
    return "Córdoba";
  }

  if (
    c.includes("posadas") ||
    c.includes("obera") ||
    c.includes("eldorado") ||
    c.includes("iguazu") ||
    c.includes("apostoles") ||
    c.includes("leandro n alem")
  ) {
    return "Misiones";
  }

  if (c.includes("formosa") || c.includes("clorinda") || c.includes("pirane")) {
    return "Formosa";
  }

  if (
    c.includes("buenos aires") ||
    c.includes("caba") ||
    c.includes("la plata") ||
    c.includes("mar del plata") ||
    c.includes("bahia blanca") ||
    c.includes("tandil") ||
    c.includes("san nicolas") ||
    c.includes("pergamino") ||
    c.includes("junin")
  ) {
    return "Buenos Aires";
  }

  if (
    c.includes("sarmiento") ||
    c.includes("comodoro rivadavia") ||
    c.includes("trelew") ||
    c.includes("madryn") ||
    c.includes("esquel") ||
    c.includes("rawson")
  ) {
    return "Chubut";
  }

  return "";
}

export function getBusinessHoursInfo(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const dayOfWeekMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miércoles: 3,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sábado: 6,
    sabado: 6
  };
  const rawWeekday = (map.weekday || "").toLowerCase().trim();
  const dayOfWeek = dayOfWeekMap[rawWeekday] ?? date.getDay();
  const dayName = map.weekday ? map.weekday.charAt(0).toUpperCase() + map.weekday.slice(1) : "Hoy";

  const hours = parseInt(map.hour, 10) || 0;
  const minutes = parseInt(map.minute, 10) || 0;
  const currentMinutes = hours * 60 + minutes;

  const formattedHours = String(hours).padStart(2, "0");
  const formattedMinutes = String(minutes).padStart(2, "0");
  const currentFormattedTime = `${formattedHours}:${formattedMinutes}`;

  let isOpen = false;
  let reopeningText = "";

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    const isMorning = currentMinutes >= 510 && currentMinutes < 750;
    const isAfternoon = currentMinutes >= 990 && currentMinutes < 1230;
    if (isMorning || isAfternoon) {
      isOpen = true;
    } else if (currentMinutes < 510) {
      reopeningText = "hoy a las 08:30hs";
    } else if (currentMinutes >= 750 && currentMinutes < 990) {
      reopeningText = "hoy por la tarde a las 16:30hs";
    } else {
      reopeningText = dayOfWeek === 5 ? "mañana sábado a las 09:00hs" : "mañana a las 08:30hs";
    }
  } else if (dayOfWeek === 6) {
    if (currentMinutes >= 540 && currentMinutes < 780) {
      isOpen = true;
    } else if (currentMinutes < 540) {
      reopeningText = "hoy sábado a las 09:00hs";
    } else {
      reopeningText = "el próximo lunes a las 08:30hs";
    }
  } else {
    reopeningText = "mañana lunes a las 08:30hs";
  }

  return {
    isOpen,
    currentDayName: dayName,
    currentFormattedTime,
    reopeningText
  };
}
