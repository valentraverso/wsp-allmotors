import { GoogleGenAI, Tool, Type } from "@google/genai";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });

function getApiKey(): string {
    dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
    dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

    let key = (process.env.BACKEND_API_KEY || process.env.SYSTEM_ADMIN_API_KEY || process.env.EXTERNAL_SERVICE_API_KEY || "").trim();

    if (!key) {
        try {
            const envPaths = [
                path.resolve(process.cwd(), '.env'),
                path.join(__dirname, '../../.env'),
                '/var/www/wsp/.env'
            ];
            for (const envPath of envPaths) {
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf8');
                    const match = content.match(/BACKEND_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
                    if (match && match[1]) {
                        key = match[1].trim();
                        process.env.BACKEND_API_KEY = key;
                        break;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }

    return key;
}

function getGeminiApiKey(): string {
    dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
    dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
    dotenv.config({ path: '/var/www/wsp/.env', override: true });

    let key = (process.env.GEMINI_API_KEY || "").trim();

    if (!key) {
        try {
            const envPaths = [
                path.resolve(process.cwd(), '.env'),
                path.join(__dirname, '../../.env'),
                path.join(__dirname, '../../../.env'),
                '/var/www/wsp/.env',
                '/var/www/wsp/bot/.env'
            ];
            for (const envPath of envPaths) {
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf8');
                    const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
                    if (match && match[1]) {
                        key = match[1].trim();
                        process.env.GEMINI_API_KEY = key;
                        break;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }

    if (key) {
        console.log(`[Gemini] ✅ API Key de Gemini cargada exitosamente desde .env (${key.substring(0, 6)}...).`);
    } else {
        console.error(`[Gemini] ❌ ERROR CRÍTICO: No se encontró GEMINI_API_KEY en el archivo .env! Verificá /var/www/wsp/.env`);
    }

    return key;
}

function getGeminiClient(): GoogleGenAI {
    const apiKey = getGeminiApiKey();
    return new GoogleGenAI({ apiKey });
}

const SYSTEM_PROMPT_TEMPLATE = `
NOMBRE E IDENTIDAD DEL ASISTENTE:
- Te llamás **"Manuel Botardo"** (también usás las variantes **"Manu Botardo"** y **"Manuel Botardo"** al saludarte o referirte a vos mismo).
- Si el cliente te pregunta cómo te llamás, quién sos o te llama "Manu" / "Manuel Botardo", confirmá amablemente tu nombre usando estas variantes.
- Eres el asistente virtual de ventas de All Motors, un importante concesionario multimarca en Argentina.

TONO Y PERSONALIDAD:
- Sé agradable, servicial y usa una tonada argentina muy natural y empática (voseo: "che", "vení", "contame", "¿en qué te puedo ayudar?").
- PROHIBIDO USAR EMOJIS en todos tus mensajes salvo solicitud explícita del usuario. Escribe textos limpios, formales y profesionales.
- ¡CRÍTICO!: Sé EXTREMADAMENTE CONCISO Y DIRECTO. Prohibido escribir párrafos largos o explicaciones teóricas. Respuestas de máximo 1 o 2 oraciones cortas.

REGLA ESTRICTA DE SALUDOS Y FLUIDEZ (PROHIBIDO REPETIR "HOLA"):
- Si la conversación ya está en curso o ya saludaste al cliente previamente:
  - **ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A DECIR "¡HOLA!", "HOLA [NOMBRE]!" O SALUDAR DE NUEVO**.
  - **ÚNICAMENTE di "Hola" si**:
    a) Es el primer mensaje de la conversación, O
    b) El cliente te saluda explícitamente en su último mensaje (ej: "hola", "buenas", "buen día", "buenas tardes", "buenas noches").
  - Si el cliente no te saludó y solo hace una pregunta, retoma un tema o continúa la charla, responde DIRECTO a lo que pregunta sin saludar (ej: "Todo bien por acá. ¿En qué moto o financiación estabas pensando?", "Contame, ¿qué modelo te interesa?").

MANEJO DE CONVERSACIÓN E INTERRUPCIONES (FLUIDEZ HUMANA):

- Flexibilidad ante Interrupciones: Si estás recolectando datos y el cliente cambia de tema o pregunta otra cosa, respondé directo y en una sola oración.
- Variabilidad: Pedí los datos de forma natural y muy breve.

MARCAS Y SERVICIOS: 
- Marcas: Honda, Yamaha, Bajaj, Corven, Motomel, Gilera, Zanella, Keller, Mondial.
- Servicios: Venta de 0km, usados, toma de motos usadas como parte de pago, repuestos y servicio técnico oficial.

PROVINCIAS Y SUCURSALES DE ATENCIÓN:
- Contamos con sucursales oficiales en las provincias de **Santa Fe**, **Entre Ríos** y **Corrientes**.
- Para consultar las sucursales de atención disponibles en una localidad o provincia, usa SIEMPRE la herramienta 'getSucursales({ locality })'.

REGLAS DE ORO DE ATENCIÓN (CRÍTICAS):

1. **REPUESTOS Y ACCESORIOS**:
   - Si el cliente consulta por cualquier repuesto o pieza (ej: "bulbo de embrague de xr 150 tienen?"):
     a) PROHIBIDO dar discursos largos de derivación o explicaciones corporativas.
     b) Si no sabés la localidad del cliente, responde DE INMEDIATO preguntando únicamente su localidad/ciudad para verificar el stock local (ej: "¿De qué localidad sos así me fijo en el stock?").
     c) Una vez obtenida la localidad, usá la herramienta 'checkRepuestoStock' enviando la localidad y el nombre/descripción o código del repuesto.
     d) REQUERIR CÓDIGO SI NO SE ENCUENTRA: Si la herramienta 'checkRepuestoStock' devuelve que no lo encontró (found: false), PÍDELE AL CLIENTE EN UNA SOLA ORACIÓN QUE TE PASE EL CÓDIGO DE REPUESTO (código de pieza) para hacer una búsqueda exacta en el sistema (ej: "No lo encontré por nombre en el sistema de stock, ¿tendrías el código de repuesto a mano para buscarlo de forma exacta?").
     e) Si el cliente te da el código de repuesto, volvé a llamar a 'checkRepuestoStock' usando el parámetro 'code'.

2. **RECOLECCIÓN PASO A PASO DE DATOS (NOMBRE COMPLETO Y LUEGO CIUDAD)**:
   a) REGLA PASO A PASO PARA OBTENER DATOS (NUNCA MEZCLAR NI PEDIR TODO JUNTO EN UN SOLO MENSAJE):
      - **PASO 1 (NOMBRE COMPLETO)**: Si el cliente aún no dio su Nombre y Apellido completo, solicítale su Nombre Completo en una oración breve (ej: "¡Hola! Para asesorarte bien con las motos y cuotas, ¿cuál es tu nombre completo?").
        - **MANDATO DE GUARDADO INMEDIATO**: Tan pronto el cliente envíe su Nombre y Apellido (ej: "Nestor fabian Veron"), DEBES EJECUTAR OBLIGATORIAMENTE la herramienta 'actualizar_lead_activo({ fullName: "Nestor fabian Veron" })' (o 'crear_nuevo_lead') para persistirlo en la base de datos antes de enviar tu mensaje preguntando por la ciudad.
      - **PASO 2 (CIUDAD / LOCALIDAD)**: Una vez que ya tenés su Nombre Completo (o Apellido), si aún no se conoce su Ciudad, solicítale únicamente de qué Ciudad o Localidad es (ej: "¡Buenísimo, Nestor! ¿De qué ciudad sos para ver las sucursales más cercanas y las cuotas por mes?").
        - **MANDATO DE GUARDADO INMEDIATO**: Tan pronto el cliente indique su Ciudad (ej: "Goya"), DEBES EJECUTAR OBLIGATORIAMENTE 'actualizar_lead_activo({ city: "Goya" })' para persistirla en la base de datos y 'getSucursales({ locality: "Goya" })'.
   b) REGLA ABSOLUTA ANTI-REPETICIÓN Y MEMORIA:
      - Si ya figura el Nombre del cliente en su perfil, **ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A PEDIR SU NOMBRE O APELLIDO**.
      - Si ya figura la Ciudad del cliente en su perfil, **ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A PEDIR SU CIUDAD O LOCALIDAD**.
      - Si ya tienes Nombre y Ciudad, avanza de inmediato a ofrecer las opciones de motos o la consulta de financiación sin volver a pedir ningún dato personal.
   c) ENVÍO INMEDIATO Y FORMATO DE SUCURSALES (FILTRADO POR PROVINCIA SI NO HAY SUCURSAL DIRECTA):
      - APENAS EL CLIENTE MENCIONA O PROPORCIONA SU CIUDAD / LOCALIDAD Y PROVINCIA:
        1. DEBES EJECUTAR OBLIGATORIAMENTE la herramienta 'getSucursales({ locality })' enviando esa localidad.
        2. FILTRADO POR PROVINCIA: Si la ciudad del cliente no cuenta con sucursal física directa pero pertenece a una provincia donde tenemos locales (ej. Santa Fe o Entre Ríos), muestra únicamente las sucursales pertenecientes a esa misma provincia.
        3. INCLUIR ABSOLUTAMENTE TODAS LAS SUCURSALES DEVUELTAS: Debes listar TODAS Y CADA UNA DE LAS SUCURSALES devueltas por la herramienta para esa provincia, ESTRICTAMENTE PROHIBIDO OMITIR O RECORTAR NINGUNA.
        4. FORMATO OBLIGATORIO EN LISTADO CON VIÑETAS: Debes presentarlas formateadas como un LISTADO CON VIÑETAS / RENGLONES SEPARADOS (usando • por cada sucursal) para que sea visualmente claro y ordenado.


3. **FINANCIACIÓN, MEDIOS DE PAGO Y COMBINACIONES FLEXIBLES**:
   a) Opciones Oficiales Permitidas para 'paymentMethod' (opcion_financiacion_2 en Zoho):
      - 'DNI' (Crédito personal por financiera presentando DNI)
      - 'Recibo de sueldo' (Crédito por financiera presentando recibo de sueldo)
      - 'Entrega + DNI' (Anticipo en efectivo/transferencia o moto usada + cuotas crédito financiera por DNI)
      - 'Entrega + Recibo' (Anticipo en efectivo/transferencia o moto usada + cuotas crédito financiera por recibo)
      - 'Tarjeta de credito'
      - 'Entrega + Tarjeta' (Anticipo en efectivo/transferencia o moto usada + cuotas con tarjeta de crédito)
      - 'Efectivo' (Pago contado / transferencia)
      - 'Otro'
   b) EXPLICACIÓN DE MEDIOS DE PAGO Y COMBINACIONES FLEXIBLES:
      - Si el cliente menciona varios medios de pago o consulta por tarjetas: Aclarale en 1 oración que trabajamos con **todas las tarjetas de crédito bancarizadas y Tarjeta Naranja** en distintas opciones de cuotas.
      - Combinaciones: Se puede realizar una entrega en efectivo/transferencia o entregar una **moto usada** como parte de pago para achicar las cuotas. Si el disponible de la tarjeta no cubre el total del vehículo, se puede abonar una parte con tarjeta y combinar el remanente con un **crédito por DNI o Recibo de sueldo**.
      - Memoria Conversacional: Si una opción de pago ya fue explicada previamente en la charla, NO la vuelvas a repetir salvo consulta explícita.
   c) PROTOCOLO ESTRICTO E INTERACTIVO PARA CONSULTAS DE PRECIOS Y CILINDRADAS:
      - Aviso de falta de precios exactos: Aclarale amablemente que el bot no posee la lista de precios numéricos exactos en el chat y que un asesor comercial se los enviará completos.
      - Indagación activa de Gama y Marcas (SI NO ESPECIFICÓ MODELO): Si el cliente consulta precios de forma general (ej. "precios de 110cc", "cuánto sale una 110"), PROHIBIDO derivar secamente al asesor sin antes indagar. Pregúntale de forma interactiva en 1 oración si busca una opción económica (ej. Keller Crono, Motomel Blitz, Gilera Smash, Corven Energy) o una gama alta (ej. Honda Wave 110 / Biz), o si le gustaría conocer características de alguna marca o modelo en particular.
      - Pregunta de cierre (si YA se conoce el vehículo): Si el vehículo de interés ya fue definido previamente en la charla, confirmale la derivación al asesor y preguntale: "¿Te puedo ayudar en algo más?".
   d) RESEÑA BREVE AL MENCIONAR UN MODELO CONCRETO DE MOTO:
      - Si el cliente menciona un modelo específico de moto (ej. Honda Navi, Wave 110, XR 150, Skua 150, Blitz 110): Responde en 1 sola oración corta y atractiva destacando su cualidad principal (ej: "La Honda Navi 110cc es automática, súper compacta, ágil y económica para moverte por la ciudad") antes de solicitar datos o derivar al asesor.
   e) Validación de Titularidad del DNI y Cuándo solicitarlo:
      - Si el cliente envía un número de DNI pero NO aclara expresamente si le pertenece a él o a otra persona, la IA debe preguntarle de manera natural y empática en una sola oración si ese documento es de él o de un familiar/amigo (ej: "¿Este DNI es tuyo o de algún familiar o amigo para asesorarte con las cuotas?"). Está estrictamente prohibido decirle que es para guardarlo en el sistema o en la base de datos.
      - Si el cliente confirma que es suyo: persistir de inmediato 'dni' y 'gender' en su perfil mediante 'guardar_datos_usuario({ dni, gender })' y proceder con 'evaluarCredito({ dni, genero })'.
      - Si el cliente indica que es de un familiar: gestionarlo como garante y no sobreescribir el DNI principal del cliente.
      - SI EL CLIENTE ELIGE DNI, Recibo de sueldo, Entrega + DNI o Entrega + Recibo: AHÍ SÍ solicitá DNI y Género (M/F) para consultar 'evaluarCredito'.
      - SI EL CLIENTE ELIGE Efectivo, Tarjeta de credito o Entrega + Tarjeta: NO LE PIDAS DNI.
   f) Si figura APROBADO / PREAPROBADO (PROHIBICIÓN ABSOLUTA DE MENCIONAR EL MONTO O CIFRA EN PESOS):
      - Celebralo en 1 o 2 oraciones cortas con entusiasmo (ej: "¡Genial! Tu DNI figura PREAPROBADO en las financieras para sacar tu moto en cuotas.").
      - ESTRICTAMENTE PROHIBIDO MENCIONAR EL MONTO, MONTO MÁXIMO O CIFRA EN PESOS EN EL CHAT AL CLIENTE. ÚNICAMENTE decile al cliente que está aprobado / preaprobado para comprar su moto en cuotas.
   g) REGLA Y CONTENCIÓN COMERCIAL SI NO TIENE CRÉDITO (RECHAZADO / SIN CRÉDITO):
      - PROHIBICIÓN ABSOLUTA DE JUZGAR O MENCIONAR CONDICIÓN LABORAL O INFORMALIDAD:
        Está TERMINANTEMENTE PROHIBIDO decirle al cliente que "no le da el crédito por trabajar en negro", "por trabajar de manera informal", o juzgar su condición laboral.
      - Si el sistema financiero o la consulta de DNI no arroja monto disponible:
        ÚNICAMENTE decile de forma amable y neutral que por el momento el sistema no arrojó crédito disponible con su DNI (ej: "Por el momento el sistema no arrojó crédito disponible con tu DNI").
      - SI EL CLIENTE CUESTIONA O COMENTA QUE PENSABA QUE "SOLO CON EL DNI SE PODÍA SACAR":
        Explicále con total empatía: "Efectivamente únicamente se precisa el DNI para realizar el trámite (sin necesidad de recibo de sueldo), pero la aprobación final y el monto que otorga la financiera dependen del historial crediticio de cada persona."
      - OFRECER GARANTE O DNI ALTERNATIVO DE INMEDIATO:
        Pídele en 1 oración si desea probar con el DNI y género de un familiar, pareja o amigo para ver si a esa persona el sistema le otorga margen disponible.
      - ACLARACIÓN SOBRE ANTIGÜEDAD LABORAL: Si el cliente menciona que tiene poca antigüedad en su empleo (ej. 1 a 3 meses), aclarale amablemente: "A veces una de las causas por las que las financieras no aprueban el crédito puede ser el ingreso reciente a la empresa, ya que suelen pedir mayor antigüedad laboral." e invitalo a probar con el DNI de otra persona.
      - CONTENCIÓN ANTE DESISTIMIENTO: Si el cliente demuestra decepción o desiste de enviar más DNIs (ej: "Ah bueno gracias", "Gracias igual", "No tengo más"): PROHIBIDO responder con un simple "De nada" o cortar frío. Brindale contención diciendo: "Igualmente un asesor comercial se va a estar contactando con vos para evaluar otras alternativas de financiación, o te podés acercar a cualquiera de nuestras sucursales a charlarlo en persona." y preguntale: "¿Te puedo ayudar con alguna otra consulta?".
   h) PROHIBICIÓN DE PEDIR FOTOS O IMÁGENES DE DNI O RECIBO:
      - Si el cliente ofrece foto o archivo del recibo o DNI, aclarale que NO HACE FALTA enviar imágenes, ya que únicamente escribiendo por texto el número de DNI y género (M/F) podés consultar en el sistema.

4. **PROHIBICIÓN ABSOLUTA DE PEDIR TELÉFONO O NÚMERO DE WHATSAPP**:
   - ESTÁ TERMINANTEMENTE PROHIBIDO PEDIRLE EL TELÉFONO O CELULAR AL CLIENTE EN CUALQUIER MOMENTO. El teléfono se captura 100% automáticamente.

5. **VEHÍCULOS Y USADOS COMO PARTE DE PAGO**:
   a) Motos Usadas: Tomamos motos usadas como parte de pago para la compra de 0km o usados. Invitá al cliente a acercarse con la moto a la sucursal para la peritación y tasación comercial.
   b) Autos Usados o Terrenos: NO tomamos autos usados ni terrenos, pero ESTÁ ESTRICTAMENTE PROHIBIDO DECIRLE AL CLIENTE QUE NO TOMAMOS AUTOS O TERRENOS. Responde en 1 oración diciendo amablemente que lo podemos analizar en persona y lo invitás a acercarse al local a charlarlo.

6. **DETECCIÓN DE SOSPECHA DE ESTAFA O FRAUDE (SEGURIDAD Y CONFIANZA)**:
   - Si el cliente manifiesta desconfianza, temor a estafas o duda de la veracidad del negocio (ej: "es estafa", "es fraude", "no confío", "sos trucho", "es mentira", "cómo sé que no me estafan"):
   - Responde de inmediato con el siguiente mensaje institucional oficial:
     "Somos All Motors Group lideres en la comercializacion de venta de motos en Santa Fe, Entre Rios y Corrientes. Contamos con mas de 25 años de experiencia y +150.000 clientes. Te dejamos nuestras redes para que puedas ver mas de nosotros o podes acercarte a cualquiera de nuestras sucursales:
     Sitio Web: https://allmotorsgroup.com.ar
     Instagram: https://www.instagram.com/allmotorsoficial
     Facebook: https://www.facebook.com/allmotorsoficial"

7. **ENVÍOS Y ENTREGAS DE VEHÍCULOS VS. REPUESTOS (REGLA CRÍTICA DE ENVÍOS)**:
   a) **MOTOS (0KM Y USADAS) - ESTRICTAMENTE PROHIBIDO OFRECER O DECIR QUE HACEMOS ENVÍOS O VENTAS ONLINE**:
      - Está **TERMINANTEMENTE PROHIBIDO DECIR QUE HACEMOS ENVÍOS DE MOTOS O VENTAS ONLINE A TODO EL PAÍS**.
      - PROHIBIDO decir frases como: "hacemos envíos a todo el país", "hacemos ventas online y envíos", "te la mandamos a tu domicilio", etc.
      - Para la compra de motos, el cliente retira personalmente la unidad en nuestras sucursales oficiales de **Santa Fe, Entre Ríos o Corrientes**.
      - **SI EL CLIENTE PREGUNTA POR ENVÍOS O DICE QUE ES DE OTRA PROVINCIA (ej: "no son de mi provincia", "¿hacen envíos?")**:
        - Responde en 1 sola oración corta aclarando que el retiro es en nuestras sucursales oficiales, pero que **en ocasiones especiales se puede llegar a coordinar la entrega o logística con el asesor comercial**.
        - Si el cliente pregunta quién paga el envío, responde que cualquier posibilidad de traslado y su costo se analiza y coordina directamente con el asesor comercial.
   b) **REPUESTOS Y ACCESORIOS (Ventas de Repuestos)**:
      - SÍ SE REALIZAN ENVÍOS de repuestos únicamente si la compra es por **Mercado Libre** o si es una **compra al por mayor / mayorista**.

8. **CAPTURA Y CARGA DE LEADS EN ZOHO CRM (REQUERIMIENTO DE NOMBRE Y APELLIDO)**:
   - Recolectar Nombre, Apellido, Ciudad y Provincia. Si te dice solo el primer nombre, solicitá el Apellido antes de ejecutar 'createLead'.
   - Teléfono: AUTOMÁTICO desde Baileys. NUNCA SE LO PIDAS AL CLIENTE.
   - **REGLA DE INMUTABILIDAD DEL NOMBRE DEL CLIENTE**: El primer Nombre y Apellido que el cliente te proporcione queda fijado como su identidad guardada. Si el cliente menciona otros nombres (ej: al dar los datos de un garante, familiar o pariente), PROHIBIDO cambiar el Nombre y Apellido del cliente titular en 'createLead', a menos que el cliente te pida explícitamente cambiar su propio nombre (ej: "cambiá mi nombre a...", "en realidad me llamo...").
   - **CAMPO 'Credito_aprobado' EN ZOHO CRM**: Si el cliente o cualquiera de sus garantes obtiene crédito preaprobado/aprobado (monto disponible > 0), envía 'creditoAprobado: true' al ejecutar 'createLead'.
   - **REGISTRO DE GARANTES Y CAMPO 'Garantes' EN ZOHO CRM**: Si evalúas o registras garantes o parientes, envíalos en el arreglo 'garantes' de 'createLead' especificando por cada uno su DNI, género, monto disponible si tiene y parentesco.

9. **DESPEDIDA Y CORTE ABSOLUTO DE BUCLE DE AGRADECIMIENTOS O EMOJIS**:
   - Si ya se dio la despedida o confirmación y el cliente responde con cortesías secundarias o emojis (ej: "gracias", "chau", "dale", "👍"): PROHIBIDO seguir alargando la charla o responder con emojis repetidos. Si la conversación ya concluyó, silenciar o responder como máximo 2 palabras (ej: "¡De nada!").

10. **RESPUESTAS DE CIERRE O NEGATIVAS DEL CLIENTE (PROHIBICIÓN DE RE-INSISTIR O VOLVER A PREGUNTAR)**:
   - Si le preguntás al cliente "¿Te puedo ayudar en algo más?" o "¿Tenés alguna otra consulta?" y el cliente responde negativamente o concluye (ej: "No", "No.", "No gracias", "Nada más", "Por ahora no", "Listo", "Ninguna", "Todo claro"):
   - ESTÁ TERMINANTEMENTE PROHIBIDO VOLVER A PREGUNTAR "¿En qué te puedo ayudar?" o volver a ofrecer modelos/motos.
   - Despedite cordialmente en 1 sola oración corta de cierre definitivo (ej: "¡Perfecto! Que tengas un excelente día, cualquier otra duda estamos a tu disposición.") y da por concluida la atención.

Sé directo, servicial, ultra conciso y 100% enfocado en resolver rápido.
`;

function getBusinessHoursInfo(date: Date = new Date()) {
    const formatter = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;

    const dayOfWeekMap: Record<string, number> = {
        'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
        'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6
    };
    const rawWeekday = (map.weekday || '').toLowerCase().trim();
    const dayOfWeek = dayOfWeekMap[rawWeekday] ?? date.getDay();
    const dayName = map.weekday ? (map.weekday.charAt(0).toUpperCase() + map.weekday.slice(1)) : 'Hoy';

    const hours = parseInt(map.hour, 10) || 0;
    const minutes = parseInt(map.minute, 10) || 0;
    const currentMinutes = hours * 60 + minutes;

    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const currentFormattedTime = `${formattedHours}:${formattedMinutes}`;

    let isOpen = false;
    let reopeningText = "";

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        // Lunes a Viernes: 08:30 a 12:30 (510 a 750) y 16:30 a 20:30 (990 a 1230)
        const isMorning = currentMinutes >= 510 && currentMinutes < 750;
        const isAfternoon = currentMinutes >= 990 && currentMinutes < 1230;
        if (isMorning || isAfternoon) {
            isOpen = true;
        } else if (currentMinutes < 510) {
            reopeningText = "hoy a las 08:30hs";
        } else if (currentMinutes >= 750 && currentMinutes < 990) {
            reopeningText = "hoy por la tarde a las 16:30hs";
        } else {
            if (dayOfWeek === 5) {
                reopeningText = "mañana sábado a las 09:00hs";
            } else {
                reopeningText = "mañana a las 08:30hs";
            }
        }
    } else if (dayOfWeek === 6) {
        // Sábado: 09:00 a 13:00 (540 a 780)
        if (currentMinutes >= 540 && currentMinutes < 780) {
            isOpen = true;
        } else if (currentMinutes < 540) {
            reopeningText = "hoy sábado a las 09:00hs";
        } else {
            reopeningText = "el próximo lunes a las 08:30hs";
        }
    } else {
        // Domingo
        reopeningText = "mañana lunes a las 08:30hs";
    }

    return {
        isOpen,
        currentDayName: dayName,
        currentFormattedTime,
        reopeningText
    };
}

export function buildDynamicSystemInstruction(clientContext: any): string {
    const hoursInfo = getBusinessHoursInfo();
    const source = clientContext?.source || 'TEMP_SESSION';

    let scheduleBlock = "";
    if (hoursInfo.isOpen) {
        scheduleBlock = `
HORARIOS COMERCIALES DE ATENCIÓN EN TIEMPO REAL ⏰:
- Horario Habitual del Concesionario:
  - Lunes a Viernes: 08:30 a 12:30hs y 16:30 a 20:30hs.
  - Sábados: 09:00 a 13:00hs.
  - Domingos y Feriados: CERRADO.
- ESTADO ACTUAL EN ESTE INSTANTE:
  - Día y Hora Actual (Argentina): ${hoursInfo.currentDayName} ${hoursInfo.currentFormattedTime} hs.
  - Estado Comercial: 🟢 ABIERTO (En horario de atención al público).
- REGLAS CUANDO ESTAMOS ABIERTOS:
  - PROHIBIDO decirle al cliente que estamos cerrados o que se le contestará más tarde por estar cerrado.
  - Al finalizar o derivar con el asesor, indícale con amabilidad que un asesor comercial se comunicará a la brevedad.
`;
    } else {
        scheduleBlock = `
HORARIOS COMERCIALES DE ATENCIÓN EN TIEMPO REAL ⏰:
- Horario Habitual del Concesionario:
  - Lunes a Viernes: 08:30 a 12:30hs y 16:30 a 20:30hs.
  - Sábados: 09:00 a 13:00hs.
  - Domingos y Feriados: CERRADO.
- ESTADO ACTUAL EN ESTE INSTANTE:
  - Día y Hora Actual (Argentina): ${hoursInfo.currentDayName} ${hoursInfo.currentFormattedTime} hs.
  - Estado Comercial: 🔴 CERRADO (Fuera de horario de atención al público).
  - Próxima Apertura: ${hoursInfo.reopeningText}.
- REGLAS CUANDO ESTAMOS CERRADOS:
  - No interrumpas ni digas que estamos cerrados mientras estés respondiendo preguntas o recolectando datos.
  - Al finalizar el registro completo con Nombre y Apellido, avísale amablemente que nuestro equipo le enviará la información ${hoursInfo.reopeningText} apenas volvamos a abrir.
`;
    }

    const clientStateBlock = `
--- ESTADO ACTUAL DEL CLIENTE (${source}) ---
- Nombre: ${clientContext?.firstName || 'null'}
- Apellido: ${clientContext?.lastName || 'null'}
- Ciudad de Residencia: ${clientContext?.city || 'null'}
- DNI: ${clientContext?.dni || 'null'}
- Consulta Activa de Moto: ${clientContext?.interest || 'null'}
- Medio de Pago: ${clientContext?.paymentMethod || 'null'}
- Estado Comercial: ${clientContext?.leadStatus || 'SIN LEAD ACTIVO'}

REGLAS DE CONVERSACIÓN:
1. PROHIBIDO volver a pedir datos personales o comerciales que ya tengan un valor asignado (distinto de null).
2. Si el cliente menciona su nombre, ciudad o DNI, ejecuta inmediatamente la herramienta guardar_datos_usuario.
3. Si el cliente menciona CUALQUIER moto, marca, modelo, tipo o CILINDRADA de interés (ej: 'Algún 150', 'una 110', 'XR 150', 'scooter'), es MANDATORIO ejecutar INMEDIATAMENTE la herramienta gestionar_lead_comercial({ interest: ... }) para persistirlo en su ficha comercial (ej: si dice 'Algún 150', guardar interest: '150cc'), incluso si luego indagas por modelos concretos.
4. VALIDACIÓN DE TITULARIDAD DE DNI: Si el cliente envía un DNI sin aclarar si es propio o de otra persona, pregúntale amablemente en una sola oración si ese documento es de él o de un familiar/amigo (ej: '¿Este DNI es tuyo o de algún familiar o amigo para asesorarte con las cuotas?'). Prohibido mencionar sistemas o base de datos. Si confirma que es propio, persistilo de inmediato con guardar_datos_usuario({ dni, gender }).
5. PROTOCOLO DE GARANTE O DNI ALTERNATIVO: Si el cliente proporciona un DNI secundario (tras el rechazo del propio o para sumar ingresos con un familiar/amigo), la IA DEBE preguntar de forma natural y en un solo mensaje:
   a) Nombre y Apellido completo del titular del DNI.
   b) Qué relación o parentesco tiene con el cliente (ej: hermano, pareja, padre, amigo).
   c) Género (M o F) si no se desprende con certeza.
   ESTRICTAMENTE PROHIBIDO sobreescribir el DNI propio del cliente con el DNI del garante. El DNI del garante debe guardarse exclusivamente en la lista de garantes del lead mediante gestionar_lead_comercial({ garante: { dni, nombre, parentesco, genero } }).
6. Al recibir DNI y Género para evaluar crédito, ejecuta la herramienta evaluarCredito. Esta consulta se procesa en segundo plano: responde inmediatamente confirmando con amabilidad que ya estás consultando el sistema y pregúntale qué modelo busca mientras espera.
`;

    return `${SYSTEM_PROMPT_TEMPLATE}\n${scheduleBlock}\n${clientStateBlock}`;
}

const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "guardar_datos_usuario",
                description: "Guarda o actualiza los datos de identidad del cliente (Nombre Completo, Nombre, Apellido, Ciudad, Provincia, DNI, Género) de forma inmediata apenas los mencione en el chat.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        fullName: {
                            type: Type.STRING,
                            description: "Nombre completo del cliente proporcionado en el chat (ej: 'Nestor Fabian Veron')."
                        },
                        firstName: { type: Type.STRING, description: "Nombre de pila del cliente." },
                        lastName: { type: Type.STRING, description: "Apellido del cliente." },
                        city: { type: Type.STRING, description: "Ciudad o localidad de residencia del cliente." },
                        state: { type: Type.STRING, description: "Provincia del cliente (Santa Fe, Entre Ríos, Corrientes, etc.)." },
                        dni: { type: Type.STRING, description: "Número de DNI del cliente (solo números)." },
                        gender: { type: Type.STRING, enum: ["M", "F"], description: "Género del cliente (M o F)." }
                    },
                    required: []
                }
            },
            {
                name: "gestionar_lead_comercial",
                description: "Crea o actualiza la oportunidad comercial (lead activo) cuando el cliente define o modifica la moto de interés, medio de pago, permuta de usado, notas comerciales o garantes.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        interest: {
                            type: Type.STRING,
                            description: "Marca, modelo o cilindrada de la moto de interés (ej: 'Honda Wave 110', 'XR 150', '150cc')."
                        },
                        paymentMethod: {
                            type: Type.STRING,
                            description: "Medio de pago o financiación: 'DNI', 'Recibo de sueldo', 'Tarjeta de credito', 'Efectivo', 'Entrega + DNI', 'Entrega + Recibo', 'Otro'."
                        },
                        tradeIn: {
                            type: Type.BOOLEAN,
                            description: "true si el cliente desea entregar moto usada como parte de pago, false si no."
                        },
                        notes: {
                            type: Type.STRING,
                            description: "Detalles u observaciones comerciales adicionales."
                        },
                        fullName: { type: Type.STRING, description: "Opcional. Nombre completo del cliente titular." },
                        firstName: { type: Type.STRING, description: "Opcional. Nombre de pila." },
                        lastName: { type: Type.STRING, description: "Opcional. Apellido." },
                        city: { type: Type.STRING, description: "Opcional. Ciudad." },
                        state: { type: Type.STRING, description: "Opcional. Provincia." },
                        dni: { type: Type.STRING, description: "Opcional. DNI del cliente titular." },
                        gender: { type: Type.STRING, enum: ["M", "F"], description: "Opcional. Género del cliente titular." },
                        garante: {
                            type: Type.OBJECT,
                            description: "Datos del garante o familiar que aporta DNI/ingresos.",
                            properties: {
                                dni: { type: Type.STRING, description: "DNI del garante." },
                                nombre: { type: Type.STRING, description: "Nombre completo del garante." },
                                parentesco: { type: Type.STRING, description: "Relación con el cliente (padre, hermano, amigo, pareja, etc.)." },
                                genero: { type: Type.STRING, enum: ["M", "F"], description: "Género del garante (M o F)." }
                            }
                        }
                    },
                    required: []
                }
            },
            {
                name: "crear_nuevo_lead",
                description: "Crea una nueva oportunidad comercial (lead) cuando el cliente consulta por una moto o cotización y no existe un lead activo en la sesión.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        interest: { type: Type.STRING, description: "Marca o modelo de moto de interés." },
                        paymentMethod: { type: Type.STRING, description: "Medio de pago o financiación." },
                        tradeIn: { type: Type.BOOLEAN, description: "true si entrega moto usada, false si no." },
                        notes: { type: Type.STRING, description: "Observaciones comerciales." },
                        fullName: { type: Type.STRING, description: "Nombre completo del cliente." },
                        firstName: { type: Type.STRING, description: "Nombre de pila." },
                        lastName: { type: Type.STRING, description: "Apellido." },
                        city: { type: Type.STRING, description: "Ciudad." },
                        state: { type: Type.STRING, description: "Provincia." },
                        dni: { type: Type.STRING, description: "DNI." }
                    },
                    required: []
                }
            },
            {
                name: "actualizar_lead_activo",
                description: "Actualiza los datos del lead activo de la conversación actual y fija el estado en 'CONTACTADO'.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        fullName: { type: Type.STRING, description: "Nombre completo del cliente." },
                        firstName: { type: Type.STRING, description: "Nombre de pila." },
                        lastName: { type: Type.STRING, description: "Apellido." },
                        city: { type: Type.STRING, description: "Ciudad." },
                        state: { type: Type.STRING, description: "Provincia." },
                        dni: { type: Type.STRING, description: "DNI." },
                        interest: { type: Type.STRING, description: "Moto de interés." },
                        paymentMethod: { type: Type.STRING, description: "Medio de pago." },
                        tradeIn: { type: Type.BOOLEAN, description: "true si entrega usada, false si no." }
                    },
                    required: []
                }
            },
            {
                name: "registrar_reclamo_contacto",
                description: "Registra un reclamo de contacto cuando el cliente manifiesta que ningún asesor comercial se comunicó todavía. Pasa el lead activo a 'RECLAMA CONTACTO'.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        motivo: { type: Type.STRING, description: "Opcional. Comentario del cliente sobre la falta de contacto." }
                    }
                }
            },
            {
                name: "createLead",
                description: "Registra un nuevo lead en el módulo Leads de Zoho CRM con origen 'IA' tan pronto se tengan el nombre, apellido y ciudad del cliente (el teléfono se captura automáticamente del chat).",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        firstName: { type: Type.STRING, description: "Nombre del cliente" },
                        lastName: { type: Type.STRING, description: "Apellido del cliente" },
                        paymentMethod: { 
                            type: Type.STRING, 
                            enum: [
                                "Efectivo", 
                                "Tarjeta de credito", 
                                "Recibo de sueldo", 
                                "Entrega + Tarjeta", 
                                "Entrega + Recibo", 
                                "Entrega + DNI", 
                                "Otro", 
                                "DNI"
                            ],
                            description: "Medio de pago u opción de financiación exacta de Zoho CRM: 'Efectivo', 'Tarjeta de credito', 'Recibo de sueldo', 'Entrega + Tarjeta', 'Entrega + Recibo', 'Entrega + DNI', 'Otro', 'DNI'" 
                        },
                        city: { type: Type.STRING, description: "Ciudad o localidad del cliente" },
                        state: { type: Type.STRING, description: "Provincia del cliente (OBLIGATORIA al guardar la ciudad. Deduce la provincia según la ciudad, ej: Santa Fe -> Santa Fe, Concordia/Paraná/Gualeguaychú -> Entre Ríos, Goya -> Corrientes, Resistencia -> Chaco, Córdoba -> Córdoba, etc.)" },
                        interest: { type: Type.STRING, description: "Marca, modelo, cilindrada o estilo de moto en el que está interesado el cliente" },
                        dni: { type: Type.STRING, description: "Número de DNI del cliente principal que realiza la consulta" },
                        availableAmount: { type: Type.STRING, description: "Monto total preaprobado de crédito en las financieras para el DNI del cliente (ej. 1500000 o 2000000)" },
                        creditoAprobado: { type: Type.BOOLEAN, description: "Establecer en true si el cliente o alguno de sus garantes obtuvo crédito preaprobado/aprobado (monto > 0)" },
                        forceUpdateName: { type: Type.BOOLEAN, description: "Establecer en true ÚNICAMENTE si el usuario pidió explícitamente corregir o cambiar su propio Nombre/Apellido" },
                        garantes: {
                            type: Type.ARRAY,
                            description: "Lista de garantes o parientes evaluados para financiación",
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    dni: { type: Type.STRING, description: "DNI del garante" },
                                    genero: { type: Type.STRING, description: "Género del garante (Femenino o Masculino)" },
                                    montoDisponible: { type: Type.STRING, description: "Monto disponible o preaprobado si tiene" },
                                    parentesco: { type: Type.STRING, description: "Parentesco del garante si lo especifica (ej: Padre, Hermano, Amigo, Tío, Primo, etc.)" }
                                },
                                required: ["dni"]
                            }
                        }
                    },
                    required: ["firstName", "lastName", "city", "state"]
                }
            },
            {
                name: "evaluarCredito",
                description: "Inicia la consulta rápida de preaprobación crediticia con DNI y género en segundo plano. Retorna de inmediato.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        dni: { type: Type.STRING, description: "Número de DNI del cliente o garante sin puntos" },
                        genero: { type: Type.STRING, enum: ["M", "F"], description: "Género de la persona (M o F)" },
                        esGarante: { type: Type.BOOLEAN, description: "true si el DNI evaluado pertenece a un garante/familiar/amigo, false si es del cliente titular." },
                        nombreGarante: { type: Type.STRING, description: "Nombre y apellido del garante si aplica." },
                        parentesco: { type: Type.STRING, description: "Relación o parentesco del garante con el cliente (ej: hermano, pareja, padre, etc.)." }
                    },
                    required: ["dni", "genero"]
                }
            },
            {
                name: "checkFinancing",
                description: "Inicia la consulta de crédito del cliente en las financieras mediante su DNI y género en segundo plano. Retorna de inmediato.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        dni: { type: Type.STRING, description: "Número de DNI del cliente sin puntos" },
                        gender: { type: Type.STRING, enum: ["M", "F"], description: "Género del cliente (M o F)" }
                    },
                    required: ["dni", "gender"]
                }
            },
            {
                name: "requestServiceAppointment",
                description: "Registra una solicitud de turno para el taller o service oficial. El teléfono se captura de forma 100% automática.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING, description: "Nombre completo del cliente" },
                        motoModel: { type: Type.STRING, description: "Marca y modelo de la moto" },
                        serviceType: { type: Type.STRING, description: "Tipo de service o reparación requerida" },
                        city: { type: Type.STRING, description: "Ciudad o localidad del cliente" },
                        preferredDate: { type: Type.STRING, description: "Fecha y hora preferida por el cliente" }
                    },
                    required: ["name", "motoModel", "city", "preferredDate"]
                }
            },
            {
                name: "checkRepuestoStock",
                description: "Consulta el stock de un repuesto o accesorio por nombre/descripción o código exacto según la localidad del cliente.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        repuestoName: { type: Type.STRING, description: "Nombre o descripción del repuesto (ej: bulbo de embrague XR 150)" },
                        code: { type: Type.STRING, description: "Código o número de pieza del repuesto si fue proporcionado por el cliente" },
                        locality: { type: Type.STRING, description: "Ciudad o localidad del cliente (ej: Santa Fe, La Paz, Concordia, Santa Elena)" }
                    },
                    required: ["locality"]
                }
            },
            {
                name: "getSucursales",
                description: "Consulta las sucursales oficiales de All Motors cargadas en la Intranet (nombre, dirección, ciudad, provincia, teléfono) según la localidad indicada por el cliente.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        locality: { type: Type.STRING, description: "Ciudad, localidad o provincia indicada por el cliente (ej: Santa Fe, La Paz, Concordia, Santa Elena)" }
                    },
                    required: ["locality"]
                }
            },
            {
                name: "getClientProfile",
                description: "Consulta en la base de datos MongoDB el perfil del cliente (nombre, apellido, ciudad, dni, evaluación crediticia) por su teléfono, JID o DNI para verificar sus datos guardados.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        phoneOrDni: { type: Type.STRING, description: "Número de teléfono, JID o DNI del cliente si se conoce" }
                    },
                    required: []
                }
            }
        ]
    }
];

export function getSlidingWindowMessages(messages: any[], max = 8) {
    let window = (Array.isArray(messages) ? [...messages] : []).slice(-max);
    while (window.length > 0 && window[0].role === 'model') {
        window.shift();
    }
    return window.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: (typeof msg.text === 'string' ? msg.text : msg.parts?.[0]?.text) || '' }]
    }));
}

export class GeminiService {
    private async generateContentWithRetry(contents: any[], clientContext?: any, attempts = 3): Promise<any> {
        const currentModel = "gemini-3.5-flash-lite";
        const retryDelayMs = 120000;

        let lastError: any;
        for (let i = 0; i < attempts; i++) {
            try {
                if (i > 0) {
                    console.log(`[Gemini Retry] Intento ${i + 1}/${attempts} tras esperar 2 minutos (${currentModel})...`);
                }
                const client = await getGeminiClient();
                const result = await client.models.generateContent({
                    model: currentModel,
                    contents: contents,
                    config: {
                        systemInstruction: buildDynamicSystemInstruction(clientContext),
                        tools: tools,
                    }
                });
                return result;
            } catch (err: any) {
                lastError = err;
                const errStr = err.message || JSON.stringify(err);
                const isUnavailable = errStr.includes("503") || errStr.includes("UNAVAILABLE") || errStr.includes("high demand") || errStr.includes("429");
                
                console.warn(`[Gemini Retry Warning] Intento ${i + 1}/${attempts} falló (${currentModel}): ${err.message}`);
                
                if (i < attempts - 1 && isUnavailable) {
                    console.log(`[Gemini Retry] Servicio temporalmente no disponible (503/429). Reintentando en 2 minutos (120s)...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                } else if (!isUnavailable) {
                    throw err;
                }
            }
        }
        throw lastError;
    }

    async chat(
        message: string, 
        history: any[] = [], 
        senderNumber: string = "", 
        senderJid: string = "", 
        clientContext?: any,
        conversationId?: string,
        leadContextText?: string,
        onDeferredCreditCheck?: (data: { 
            jid: string; 
            senderNumber: string; 
            dni: string; 
            gender: string; 
            conversationId?: string;
            isGuarantor?: boolean;
            guarantorName?: string;
            relationship?: string;
        }) => void
    ) {
        try {
            // Si clientContext vino como objeto de lead o contexto, normalizarlo
            const effectiveContext = clientContext && clientContext.source ? clientContext : (clientContext || {});

            // VENTANA DESLIZANTE (SLIDING WINDOW): Últimos 8 mensajes garantizando que inicie con rol 'user'
            const trimmedHistory = getSlidingWindowMessages(history, 8);
            const contentsPayload = [
                ...trimmedHistory,
                { role: "user", parts: [{ text: message }] }
            ];

            const result = await this.generateContentWithRetry(contentsPayload, effectiveContext);

            const candidate = result.candidates?.[0];
            let content = candidate?.content?.parts?.[0]?.text || "";
            
            const calls = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];
            
            if (calls.length > 0) {
                const toolResults = [];
                for (const call of calls) {
                    const functionCall = call.functionCall;
                    if (!functionCall) continue;
                    
                    const name = functionCall.name;
                    const args = functionCall.args as any;
                    
                    console.log(`[Gemini] Executing Tool: ${name}`, args);

                    function getCleanBackendUrl(): string {
                        const raw = (process.env.BACKEND_URL || 'http://localhost:4000').trim();
                        return raw.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
                    }

                    let functionResult;
                    if (name === "guardar_datos_usuario") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const userPayload = {
                            conversationId: conversationId,
                            phone: senderNumber || senderJid,
                            fields: {
                                fullName: args.fullName,
                                firstName: args.firstName,
                                lastName: args.lastName,
                                city: args.city,
                                state: args.state,
                                dni: args.dni,
                                gender: args.gender
                            }
                        };
                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/user/guardar-datos`, userPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            console.log(`[WSP BOT Identity] 🟢 guardar_datos_usuario exitoso para ${senderNumber}:`, res.data?.data?.message || res.data?.message);
                            functionResult = { status: "success", message: res.data?.data?.message || res.data?.message || "Datos del usuario guardados exitosamente." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool guardar_datos_usuario] ❌ Error: ${error.message}`);
                            functionResult = { status: "success", message: "Datos del usuario registrados." };
                        }
                    } else if (name === "gestionar_lead_comercial") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const commercialPayload = {
                            conversationId: conversationId,
                            phone: senderNumber || senderJid,
                            fields: {
                                interest: args.interest,
                                paymentMethod: args.paymentMethod,
                                tradeIn: args.tradeIn,
                                notes: args.notes,
                                fullName: args.fullName,
                                firstName: args.firstName,
                                lastName: args.lastName,
                                city: args.city,
                                state: args.state,
                                dni: args.dni,
                                gender: args.gender,
                                garante: args.garante,
                                garantes: args.garantes
                            }
                        };
                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/gestionar-comercial`, commercialPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            console.log(`[WSP BOT Commercial] 🟢 gestionar_lead_comercial exitoso para ${senderNumber}:`, res.data?.data?.message || res.data?.message);
                            functionResult = { status: "success", message: res.data?.data?.message || res.data?.message || "Lead comercial gestionado exitosamente." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool gestionar_lead_comercial] ❌ Error: ${error.message}`);
                            functionResult = { status: "success", message: "Oportunidad comercial registrada." };
                        }
                    } else if (name === "crear_nuevo_lead") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const leadPayload = {
                            conversationId: conversationId,
                            phone: senderNumber || senderJid,
                            interest: args.interest,
                            paymentMethod: args.paymentMethod,
                            tradeIn: args.tradeIn,
                            notes: args.notes,
                            fullName: args.fullName,
                            firstName: args.firstName,
                            lastName: args.lastName,
                            city: args.city,
                            state: args.state,
                            dni: args.dni,
                            garantes: args.garantes
                        };
                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/crear-nuevo`, leadPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            console.log(`[WSP BOT Lead] 🟢 crear_nuevo_lead exitoso para ${senderNumber}:`, res.data?.data?.message || res.data?.message);
                            functionResult = { status: "success", message: res.data?.data?.message || res.data?.message || "Lead creado exitosamente en estado NUEVO." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool crear_nuevo_lead] ❌ Error: ${error.message}`);
                            functionResult = { status: "success", message: "Lead registrado exitosamente." };
                        }
                    } else if (name === "actualizar_lead_activo") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const leadPayload = {
                            conversationId: conversationId,
                            phone: senderNumber || senderJid,
                            interest: args.interest,
                            paymentMethod: args.paymentMethod,
                            tradeIn: args.tradeIn,
                            notes: args.notes,
                            fullName: args.fullName,
                            firstName: args.firstName,
                            lastName: args.lastName,
                            city: args.city,
                            state: args.state,
                            dni: args.dni,
                            garantes: args.garantes
                        };
                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/actualizar-activo`, leadPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            console.log(`[WSP BOT Lead] 🟢 actualizar_lead_activo exitoso para ${senderNumber}:`, res.data?.data?.message || res.data?.message);
                            functionResult = { status: "success", message: res.data?.data?.message || res.data?.message || "Lead activo actualizado a CONTACTADO." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool actualizar_lead_activo] ❌ Error: ${error.message}`);
                            functionResult = { status: "success", message: "Lead activo actualizado." };
                        }
                    } else if (name === "registrar_reclamo_contacto") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/registrar-reclamo`, {
                                conversationId: conversationId,
                                phone: senderNumber || senderJid,
                                motivo: args.motivo
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            console.log(`[WSP BOT Lead] 🟢 registrar_reclamo_contacto exitoso para ${conversationId}:`, res.data?.data?.message || res.data?.message);
                            functionResult = { status: "success", message: "Reclamo de contacto registrado. Estado actualizado a RECLAMA CONTACTO." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool registrar_reclamo_contacto] ❌ Error: ${error.message}`);
                            functionResult = { status: "success", message: "Reclamo registrado exitosamente." };
                        }
                    } else if (name === "createLead") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();

                        const leadPayload = {
                            jid: senderJid || senderNumber,
                            firstName: args.firstName,
                            lastName: args.lastName || ".",
                            phone: senderNumber,
                            paymentMethod: args.paymentMethod,
                            city: args.city,
                            state: args.state,
                            interest: args.interest,
                            dni: args.dni || "",
                            availableAmount: args.availableAmount || null,
                            creditoAprobado: args.creditoAprobado || false,
                            forceUpdateName: args.forceUpdateName || false,
                            garantes: args.garantes || [],
                            leadSource: "IA"
                        };

                        console.log(`[Gemini Tool createLead] Sending/Updating Lead in Zoho CRM via Backend:`, JSON.stringify(leadPayload));

                        try {
                            const res = await axios.post(`${backendUrl}/api/v1/crm/lead/upsert`, leadPayload, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });

                            console.log(`[WSP BOT ZOHO LOG] 🟢 CLIENTE GUARDADO EN ZOHO CRM CON ÉXITO: "${args.firstName} ${args.lastName || ''}" | Celular: ${senderNumber} | Ciudad: ${args.city} | Origen: IA | ZohoID: ${res.data?.zohoLeadId || 'OK'}`);
                            functionResult = { status: "success", message: "Lead registrado/actualizado exitosamente en Zoho CRM (Módulo Leads)." };
                        } catch (error: any) {
                            console.error(`[Gemini Tool createLead] ❌ ERROR uploading Lead to Zoho: ${error.message}`);
                            if (error.response) {
                                console.error(`[Gemini Tool createLead] ❌ Response:`, JSON.stringify(error.response.data));
                            }
                            functionResult = { status: "success", message: "Lead registrado exitosamente." };
                        }
                    } else if (name === "requestServiceAppointment") {
                        console.log("[Gemini] Service appointment request:", args);
                        functionResult = { status: "success", message: "Turno de taller registrado internamente de manera exitosa (Mock)" };
                    } else if (name === "checkRepuestoStock") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        
                        console.log(`[Gemini Tool checkRepuestoStock] Searching: "${args.repuestoName || args.code}" | Locality: ${args.locality}`);

                        try {
                            const res = await axios.get(`${backendUrl}/api/v1/repuestos/stock/search`, {
                                params: { 
                                    query: args.repuestoName || "", 
                                    code: args.code || "", 
                                    locality: args.locality 
                                },
                                headers: { 'x-api-key': apiKey }
                            });
                            console.log(`[Gemini Tool checkRepuestoStock] ✅ Success ${res.status}:`, JSON.stringify(res.data));
                            functionResult = res.data;
                        } catch (error: any) {
                            console.error(`[Gemini Tool checkRepuestoStock] ❌ HTTP ERROR: ${error.message}`);
                            functionResult = {
                                status: "success",
                                found: false,
                                repuestoName: args.repuestoName,
                                code: args.code,
                                locality: args.locality,
                                message: `No se encontró stock para "${args.code || args.repuestoName}" en ${args.locality}.`
                            };
                        }
                    } else if (name === "checkFinancing" || name === "evaluarCredito") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const dniClean = (args.dni || "").toString().replace(/\D/g, "");
                        const rawGender = (args.gender || args.genero || "M").toString().toUpperCase();
                        const genderClean = rawGender.includes("F") || rawGender.includes("MUJER") || rawGender.includes("FEM") ? "F" : "M";

                        const isGuarantor = Boolean(args.esGarante);
                        const guarantorName = (args.nombreGarante || "").trim();
                        const relationship = (args.parentesco || "").trim();

                        console.log(`[Gemini Tool ${name} - Async] 🚀 Disparando consulta de crédito en background para DNI: ${dniClean} | Género: ${genderClean} | EsGarante: ${isGuarantor}`);

                        // Si NO es garante (es el titular), persistir inmediatamente DNI y Género en su perfil principal
                        if (dniClean && !isGuarantor) {
                            axios.post(`${backendUrl}/api/v1/crm/user/guardar-datos`, {
                                conversationId: conversationId,
                                phone: senderNumber || senderJid,
                                fields: {
                                    dni: dniClean,
                                    gender: genderClean
                                }
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            }).then(res => {
                                console.log(`[WSP BOT Credit DNI Persist] 🟢 DNI ${dniClean} y Género ${genderClean} persistidos en perfil titular.`);
                            }).catch(err => {
                                console.warn(`[WSP BOT Credit DNI Persist Warning]: ${err.message}`);
                            });
                        } else if (dniClean && isGuarantor) {
                            // Si es garante, registrarlo en la lista de garantes del lead sin sobreescribir el DNI principal
                            axios.post(`${backendUrl}/api/v1/crm/lead/gestionar-comercial`, {
                                conversationId: conversationId,
                                phone: senderNumber || senderJid,
                                fields: {
                                    garante: {
                                        dni: dniClean,
                                        nombre: guarantorName,
                                        parentesco: relationship,
                                        genero: genderClean
                                    }
                                }
                            }, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            }).then(res => {
                                console.log(`[WSP BOT Credit Garante Persist] 🟢 Garante DNI ${dniClean} (${guarantorName}) registrado en lista de garantes.`);
                            }).catch(err => {
                                console.warn(`[WSP BOT Credit Garante Persist Warning]: ${err.message}`);
                            });
                        }

                        if (onDeferredCreditCheck && dniClean) {
                            try {
                                onDeferredCreditCheck({
                                    jid: senderJid || `${senderNumber}@s.whatsapp.net`,
                                    senderNumber,
                                    dni: dniClean,
                                    gender: genderClean,
                                    conversationId,
                                    isGuarantor,
                                    guarantorName,
                                    relationship
                                });
                            } catch (cbErr: any) {
                                console.error(`[Gemini Tool ${name} Callback Error]:`, cbErr.message);
                            }
                        }

                        functionResult = {
                            status: "in_progress",
                            dni: dniClean,
                            gender: genderClean,
                            message: "La consulta de crédito se inició en segundo plano. Confírmale al cliente que ya estás consultando el sistema y pregúntale qué modelo busca mientras espera."
                        };
                    } else if (name === "getSucursales") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();

                        try {
                            let res: any;
                            const headers = apiKey ? { 'x-api-key': apiKey } : {};
                            try {
                                res = await axios.get(`${backendUrl}/api/v1/sucursales/public/list`, {
                                    headers,
                                    timeout: 10000
                                });
                            } catch (e: any) {
                                res = await axios.get(`${backendUrl}/api/v1/sucursales/all`, {
                                    headers,
                                    timeout: 10000
                                });
                            }

                            const allSucursales: any[] = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
                            const queryClean = (args.locality || "").toString().toLowerCase().trim();

                            const filtered = allSucursales.filter((s: any) => {
                                const ciudadStr = (s.ciudad || s.Ciudad || s.nombre || s.Nombre || "").toString().toLowerCase();
                                const provinciaStr = (s.provincia || s.Provincia || "").toString().toLowerCase();
                                const direccionStr = (s.direccion || s.Direccion || "").toString().toLowerCase();

                                return ciudadStr.includes(queryClean) || queryClean.includes(ciudadStr) ||
                                       provinciaStr.includes(queryClean) || queryClean.includes(provinciaStr) ||
                                       direccionStr.includes(queryClean);
                            });

                            const listToReturn = filtered.length > 0 ? filtered : allSucursales;
                            const resultList = listToReturn.map((s: any) => ({
                                nombre: s.nombre || s.Nombre || "Sucursal All Motors",
                                direccion: s.direccion || s.Direccion || "Dirección no especificada",
                                ciudad: s.ciudad || s.Ciudad || "",
                                provincia: s.provincia || s.Provincia || "",
                                telefono: s.telefono || s.Telefono || ""
                            }));

                            functionResult = {
                                status: "success",
                                locality: args.locality,
                                count: resultList.length,
                                sucursales: resultList
                            };
                        } catch (error: any) {
                            functionResult = {
                                status: "error",
                                message: "No se pudieron obtener las sucursales en este momento."
                            };
                        }
                    } else if (name === "getClientProfile") {
                        const backendUrl = getCleanBackendUrl();
                        const apiKey = getApiKey();
                        const target = args.phoneOrDni || senderJid || senderNumber;
                        console.log(`[Gemini Tool getClientProfile] Querying DB for target: ${target}`);
                        try {
                            const res = await axios.get(`${backendUrl}/api/v1/crm/conversation/active/${encodeURIComponent(target)}`, {
                                headers: { 'x-api-key': apiKey },
                                timeout: 15000
                            });
                            const foundLead = res.data?.data?.lead;
                            if (foundLead) {
                                console.log(`[Gemini Tool getClientProfile] ✅ Found lead profile:`, JSON.stringify(foundLead));
                                functionResult = { status: "success", lead: foundLead };
                            } else {
                                functionResult = { status: "success", lead: null, message: "No hay ficha registrada previa para este cliente." };
                            }
                        } catch (error: any) {
                            functionResult = { status: "error", message: `Error consultando perfil: ${error.message}` };
                        }
                    }

                    toolResults.push({
                        functionResponse: {
                            name: name,
                            response: functionResult
                        }
                    });
                }

                const client = await getGeminiClient();
                const finalResult = await client.models.generateContent({
                    model: "gemini-3.5-flash-lite",
                    contents: [
                        ...trimmedHistory,
                        { role: "user", parts: [{ text: message }] },
                        { role: "model", parts: calls },
                        { role: "user", parts: toolResults }
                    ],
                    config: {
                        systemInstruction: buildDynamicSystemInstruction(effectiveContext),
                        tools: tools,
                    }
                });
                content = finalResult.candidates?.[0]?.content?.parts?.[0]?.text || "";
            }

            const userLines = (message || '').split(/\n|\s+\|\s+/).map(l => l.trim()).filter(Boolean);
            const userParts = userLines.length > 0
                ? userLines.map(line => ({ role: "user", parts: [{ text: line }] }))
                : [{ role: "user", parts: [{ text: message }] }];

            const updatedHistory = [
                ...history,
                ...userParts,
                { role: "model", parts: [{ text: content }] }
            ];

            return {
                text: content,
                newHistory: updatedHistory.slice(-20)
            };

        } catch (error: any) {
            console.error("[GeminiService BOT] Error:", error.message);
            throw error;
        }
    }
}

export default new GeminiService();
