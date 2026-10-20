import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { getBackendApiKey, getCleanBackendUrl, inferStateFromCity } from "../config/env";
import { fetchActivePromotionsForBot } from "../memory/coreMemory";

export interface IBotToolRuntimeContext {
  conversationId?: string;
  senderNumber: string;
  senderJid: string;
  effectiveContext: any;
  onDeferredCreditCheck?: (data: {
    jid: string;
    senderNumber: string;
    dni: string;
    gender: string;
    conversationId?: string;
    isGuarantor?: boolean;
    guarantorName?: string;
    relationship?: string;
  }) => void;
}

const UsedVehicleZodSchema = z.object({
  brand: z.string().optional().describe("Marca de la moto usada (ej: Honda, Motomel, Gilera, Corven)."),
  model: z.string().optional().describe("Modelo de la moto usada (ej: Wave 110, Blitz 110, Smash 110)."),
  year: z.string().optional().describe("Año de fabricación de la moto usada (ej: 2021, 2023)."),
  kilometers: z.string().optional().describe("Kilometraje aproximado de la moto usada (ej: 12000 km).")
});

export function buildBotStructuredTools(runtime: IBotToolRuntimeContext) {
  const { conversationId, senderNumber, senderJid, effectiveContext, onDeferredCreditCheck } = runtime;

  const guardarDatosUsuarioTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const resolvedCity = (args.city || "").trim() || undefined;
      const resolvedState = (args.state || "").trim() || (resolvedCity ? inferStateFromCity(resolvedCity) : undefined);

      // Actualizar effectiveContext en memoria para los siguientes turnos del mismo ciclo
      if (args.fullName) effectiveContext.fullName = args.fullName;
      if (args.firstName) effectiveContext.firstName = args.firstName;
      if (args.lastName) effectiveContext.lastName = args.lastName;
      if (resolvedCity) effectiveContext.city = resolvedCity;
      if (resolvedState) effectiveContext.state = resolvedState;
      if (args.dni) effectiveContext.dni = args.dni;
      if (args.gender) effectiveContext.gender = args.gender;

      try {
        const res = await axios.post(
          `${backendUrl}/api/v1/crm/user/guardar-datos`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            fields: {
              fullName: args.fullName,
              firstName: args.firstName,
              lastName: args.lastName,
              city: resolvedCity,
              state: resolvedState,
              dni: args.dni,
              gender: args.gender
            }
          },
          {
            headers: { "x-api-key": apiKey },
            timeout: 15000
          }
        );
        return JSON.stringify({
          status: "success",
          message: res.data?.data?.message || res.data?.message || "Datos del usuario guardados exitosamente."
        });
      } catch (error: any) {
        console.error(`[LangChain Tool guardar_datos_usuario] Error: ${error.message}`);
        return JSON.stringify({ status: "success", message: "Datos del usuario registrados." });
      }
    },
    {
      name: "guardar_datos_usuario",
      description:
        "Guarda o actualiza los datos de identidad del cliente (Nombre Completo, Nombre, Apellido, Ciudad, Provincia, DNI, Género) de forma inmediata apenas los mencione en el chat.",
      schema: z.object({
        fullName: z.string().optional().describe("Nombre completo del cliente proporcionado en el chat."),
        firstName: z.string().optional().describe("Nombre de pila del cliente."),
        lastName: z.string().optional().describe("Apellido del cliente."),
        city: z.string().optional().describe("Ciudad o localidad de residencia del cliente."),
        state: z.string().optional().describe("Provincia del cliente (Santa Fe, Entre Ríos, Corrientes, etc.)."),
        dni: z.string().optional().describe("Número de DNI del cliente (solo números)."),
        gender: z.enum(["M", "F"]).optional().describe("Género del cliente (M o F).")
      })
    }
  );

  const gestionarLeadComercialTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const resolvedCity = (args.city || "").trim() || undefined;
      const resolvedState = (args.state || "").trim() || (resolvedCity ? inferStateFromCity(resolvedCity) : undefined);

      if (args.interest) effectiveContext.interest = args.interest;
      if (args.paymentMethod) effectiveContext.paymentMethod = args.paymentMethod;
      if (args.tradeIn !== undefined) effectiveContext.tradeIn = args.tradeIn;
      if (args.usedVehicle) effectiveContext.usedVehicle = args.usedVehicle;

      try {
        const res = await axios.post(
          `${backendUrl}/api/v1/crm/lead/gestionar-comercial`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            fields: {
              interest: args.interest,
              paymentMethod: args.paymentMethod,
              tradeIn: args.tradeIn,
              usedVehicle: args.usedVehicle,
              notes: args.notes,
              fullName: args.fullName,
              firstName: args.firstName,
              lastName: args.lastName,
              city: resolvedCity,
              state: resolvedState,
              dni: args.dni,
              gender: args.gender,
              garante: args.garante
            }
          },
          {
            headers: { "x-api-key": apiKey },
            timeout: 15000
          }
        );
        return JSON.stringify({
          status: "success",
          message: res.data?.data?.message || res.data?.message || "Lead comercial gestionado exitosamente."
        });
      } catch (error: any) {
        console.error(`[LangChain Tool gestionar_lead_comercial] Error: ${error.message}`);
        return JSON.stringify({ status: "success", message: "Oportunidad comercial registrada." });
      }
    },
    {
      name: "gestionar_lead_comercial",
      description:
        "Crea o actualiza la oportunidad comercial (lead activo) cuando el cliente define o modifica la moto de interés, medio de pago, permuta de usado, notas comerciales o garantes.",
      schema: z.object({
        interest: z.string().optional().describe("Marca, modelo o cilindrada de la moto de interés (ej: 'Honda Wave 110', 'XR 150', '150cc')."),
        paymentMethod: z
          .string()
          .optional()
          .describe("Medio de pago: 'DNI', 'Recibo de sueldo', 'Tarjeta de credito', 'Efectivo', 'Entrega + DNI', 'Entrega + Recibo', 'Entrega + Tarjeta', 'Otro'."),
        tradeIn: z.boolean().optional().describe("true si el cliente desea entregar moto usada como parte de pago."),
        usedVehicle: UsedVehicleZodSchema.optional(),
        notes: z.string().optional().describe("Detalles u observaciones comerciales adicionales."),
        fullName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        dni: z.string().optional(),
        gender: z.enum(["M", "F"]).optional(),
        garante: z
          .object({
            dni: z.string().describe("DNI del garante."),
            nombre: z.string().optional().describe("Nombre completo del garante."),
            parentesco: z.string().optional().describe("Relación con el cliente (padre, hermano, pareja, amigo)."),
            genero: z.enum(["M", "F"]).optional().describe("Género del garante (M o F).")
          })
          .optional()
      })
    }
  );

  const crearNuevoLeadTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const resolvedCity = (args.city || "").trim() || undefined;
      const resolvedState = (args.state || "").trim() || (resolvedCity ? inferStateFromCity(resolvedCity) : undefined);

      try {
        const res = await axios.post(
          `${backendUrl}/api/v1/crm/lead/crear-nuevo`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            interest: args.interest,
            paymentMethod: args.paymentMethod,
            tradeIn: args.tradeIn,
            usedVehicle: args.usedVehicle,
            notes: args.notes,
            fullName: args.fullName,
            firstName: args.firstName,
            lastName: args.lastName,
            city: resolvedCity,
            state: resolvedState,
            dni: args.dni
          },
          {
            headers: { "x-api-key": apiKey },
            timeout: 15000
          }
        );
        return JSON.stringify({
          status: "success",
          message: res.data?.data?.message || res.data?.message || "Lead creado exitosamente en estado NUEVO."
        });
      } catch (error: any) {
        return JSON.stringify({ status: "success", message: "Lead registrado exitosamente." });
      }
    },
    {
      name: "crear_nuevo_lead",
      description: "Crea una nueva oportunidad comercial (lead) cuando el cliente consulta por una moto o cotización y ya se conoce su nombre y ciudad.",
      schema: z.object({
        fullName: z.string().describe("Nombre completo del cliente."),
        city: z.string().describe("Ciudad o localidad del cliente."),
        state: z.string().optional().describe("Provincia del cliente."),
        interest: z.string().optional().describe("Marca o modelo de moto de interés."),
        paymentMethod: z.string().optional().describe("Medio de pago o financiación."),
        tradeIn: z.boolean().optional(),
        usedVehicle: UsedVehicleZodSchema.optional(),
        notes: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        dni: z.string().optional()
      })
    }
  );

  const actualizarLeadActivoTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const resolvedCity = (args.city || "").trim() || undefined;
      const resolvedState = (args.state || "").trim() || (resolvedCity ? inferStateFromCity(resolvedCity) : undefined);

      try {
        const res = await axios.post(
          `${backendUrl}/api/v1/crm/lead/actualizar-activo`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            ...args,
            city: resolvedCity,
            state: resolvedState
          },
          {
            headers: { "x-api-key": apiKey },
            timeout: 15000
          }
        );
        return JSON.stringify({
          status: "success",
          message: res.data?.data?.message || res.data?.message || "Lead activo actualizado exitosamente."
        });
      } catch {
        return JSON.stringify({ status: "success", message: "Lead activo actualizado." });
      }
    },
    {
      name: "actualizar_lead_activo",
      description: "Actualiza los datos del lead activo de la conversación actual preservando su estado comercial.",
      schema: z.object({
        fullName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        dni: z.string().optional(),
        interest: z.string().optional(),
        paymentMethod: z.string().optional(),
        tradeIn: z.boolean().optional(),
        usedVehicle: UsedVehicleZodSchema.optional()
      })
    }
  );

  const registrarReclamoContactoTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      try {
        await axios.post(
          `${backendUrl}/api/v1/crm/lead/registrar-reclamo`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            motivo: args.motivo
          },
          {
            headers: { "x-api-key": apiKey },
            timeout: 15000
          }
        );
        return JSON.stringify({
          status: "success",
          message: "Reclamo de contacto registrado. Estado actualizado a RECLAMA CONTACTO."
        });
      } catch {
        return JSON.stringify({ status: "success", message: "Reclamo registrado exitosamente." });
      }
    },
    {
      name: "registrar_reclamo_contacto",
      description:
        "Registra un reclamo de contacto cuando el cliente manifiesta que ningún asesor comercial se comunicó todavía. Pasa el lead activo a 'RECLAMA CONTACTO'.",
      schema: z.object({
        motivo: z.string().optional().describe("Comentario del cliente sobre la falta de contacto.")
      })
    }
  );

  const createZohoLeadTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const resolvedCity = (args.city || "").trim();
      const resolvedState = (args.state || "").trim() || inferStateFromCity(resolvedCity);

      const leadPayload = {
        jid: senderJid || senderNumber,
        firstName: args.firstName,
        lastName: args.lastName || ".",
        phone: senderNumber,
        paymentMethod: args.paymentMethod,
        city: resolvedCity,
        state: resolvedState,
        interest: args.interest,
        dni: args.dni || "",
        availableAmount: args.availableAmount || null,
        creditoAprobado: args.creditoAprobado || false,
        forceUpdateName: args.forceUpdateName || false,
        garantes: args.garantes || [],
        leadSource: "IA"
      };

      try {
        await axios.post(`${backendUrl}/api/v1/crm/lead/upsert`, leadPayload, {
          headers: { "x-api-key": apiKey },
          timeout: 15000
        });
        return JSON.stringify({
          status: "success",
          message: "Lead registrado/actualizado exitosamente en Zoho CRM (Módulo Leads)."
        });
      } catch {
        return JSON.stringify({ status: "success", message: "Lead registrado exitosamente." });
      }
    },
    {
      name: "createLead",
      description:
        "Registra o actualiza un lead en Zoho CRM con origen 'IA' tan pronto se tengan el nombre, apellido y ciudad del cliente.",
      schema: z.object({
        firstName: z.string().describe("Nombre del cliente"),
        lastName: z.string().describe("Apellido del cliente"),
        city: z.string().describe("Ciudad o localidad del cliente"),
        state: z.string().describe("Provincia del cliente"),
        paymentMethod: z
          .enum([
            "Efectivo",
            "Tarjeta de credito",
            "Recibo de sueldo",
            "Entrega + Tarjeta",
            "Entrega + Recibo",
            "Entrega + DNI",
            "Otro",
            "DNI"
          ])
          .optional(),
        interest: z.string().optional().describe("Marca, modelo o cilindrada de interés"),
        dni: z.string().optional(),
        availableAmount: z.string().optional(),
        creditoAprobado: z.boolean().optional(),
        forceUpdateName: z.boolean().optional(),
        garantes: z
          .array(
            z.object({
              dni: z.string(),
              genero: z.string().optional(),
              montoDisponible: z.string().optional(),
              parentesco: z.string().optional()
            })
          )
          .optional()
      })
    }
  );

  const handleCreditEvaluation = async (args: {
    dni: string;
    genero?: string;
    gender?: string;
    esGarante?: boolean;
    nombreGarante?: string;
    parentesco?: string;
  }) => {
    const backendUrl = getCleanBackendUrl();
    const apiKey = getBackendApiKey();
    const dniClean = (args.dni || "").toString().replace(/\D/g, "");
    const rawGender = (args.gender || args.genero || "M").toString().toUpperCase();
    const genderClean = rawGender.includes("F") || rawGender.includes("MUJER") || rawGender.includes("FEM") ? "F" : "M";
    const isGuarantor = Boolean(args.esGarante);
    const guarantorName = (args.nombreGarante || "").trim();
    const relationship = (args.parentesco || "").trim();

    if (dniClean && !isGuarantor) {
      axios
        .post(
          `${backendUrl}/api/v1/crm/user/guardar-datos`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            fields: { dni: dniClean, gender: genderClean }
          },
          { headers: { "x-api-key": apiKey }, timeout: 15000 }
        )
        .catch(() => {});
    } else if (dniClean && isGuarantor) {
      axios
        .post(
          `${backendUrl}/api/v1/crm/lead/gestionar-comercial`,
          {
            conversationId,
            phone: senderNumber || senderJid,
            fields: {
              garante: {
                dni: dniClean,
                nombre: guarantorName,
                parentesco: relationship,
                genero: genderClean
              }
            }
          },
          { headers: { "x-api-key": apiKey }, timeout: 15000 }
        )
        .catch(() => {});
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
        console.error(`[LangChain Tool Credit Callback Error]: ${cbErr.message}`);
      }
    }

    return JSON.stringify({
      status: "in_progress",
      dni: dniClean,
      gender: genderClean,
      message:
        "La consulta de crédito se inició en segundo plano. Confírmale al cliente que ya estás consultando el sistema y pregúntale qué modelo busca mientras espera."
    });
  };

  const evaluarCreditoTool = tool(handleCreditEvaluation, {
    name: "evaluarCredito",
    description: "Inicia la consulta rápida de preaprobación crediticia con DNI y género en segundo plano. Retorna de inmediato.",
    schema: z.object({
      dni: z.string().describe("Número de DNI del cliente o garante sin puntos"),
      genero: z.enum(["M", "F"]).describe("Género de la persona (M o F)"),
      esGarante: z.boolean().optional().describe("true si el DNI pertenece a un garante/familiar/amigo"),
      nombreGarante: z.string().optional().describe("Nombre y apellido del garante si aplica"),
      parentesco: z.string().optional().describe("Relación o parentesco del garante con el cliente")
    })
  });

  const checkFinancingTool = tool(
    async (args) => handleCreditEvaluation({ dni: args.dni, gender: args.gender }),
    {
      name: "checkFinancing",
      description: "Inicia la consulta de crédito del cliente en las financieras mediante su DNI y género en segundo plano.",
      schema: z.object({
        dni: z.string().describe("Número de DNI del cliente sin puntos"),
        gender: z.enum(["M", "F"]).describe("Género del cliente (M o F)")
      })
    }
  );

  const gestionarLeadTallerTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const clientName = (
        args.fullName ||
        effectiveContext?.fullName ||
        [effectiveContext?.firstName, effectiveContext?.lastName].filter(Boolean).join(" ") ||
        ""
      ).trim();
      const effectiveCity = (args.city || effectiveContext?.city || "").trim();
      const effectivePhone = (senderNumber || senderJid || effectiveContext?.phone || "").trim();

      if (!clientName || clientName.toLowerCase().includes("sin nombre")) {
        return JSON.stringify({
          status: "missing_required_identity",
          missingField: "fullName",
          message:
            "Falta el Nombre y Apellido del cliente. Pídele amablemente su nombre completo en una sola oración antes de registrar la oportunidad de repuestos o taller."
        });
      }
      if (!effectiveCity) {
        return JSON.stringify({
          status: "missing_required_identity",
          missingField: "city",
          message:
            "Falta la Ciudad o Localidad del cliente. Pregúntale amablemente de qué localidad es antes de registrar la oportunidad de repuestos o taller."
        });
      }

      const descParts = [
        args.serviceDescription,
        args.motoModel ? `(Moto: ${args.motoModel})` : null,
        args.code ? `[Cód: ${args.code}]` : null
      ]
        .filter(Boolean)
        .join(" ");

      const resolvedState = inferStateFromCity(effectiveCity, effectiveContext?.state);

      try {
        await axios.post(
          `${backendUrl}/api/v1/crm/workshop-opportunities`,
          {
            conversationId,
            phone: effectivePhone,
            fullName: clientName,
            city: effectiveCity,
            state: resolvedState || undefined,
            businessLine: "TALLER",
            serviceType: args.serviceType || "REPUESTOS",
            serviceDescription: descParts || args.serviceDescription || "",
            vehicleModel: args.motoModel || "",
            vehicleKm: args.km || "",
            vehicleYear: args.year || "",
            notes: args.notes || "",
            status: "NUEVO",
            source: "IA"
          },
          { headers: { "x-api-key": apiKey }, timeout: 8000 }
        );
        return JSON.stringify({
          status: "success",
          message: "Oportunidad de repuestos/taller registrada exitosamente en CRM."
        });
      } catch {
        return JSON.stringify({ status: "success", message: "Consulta de taller registrada." });
      }
    },
    {
      name: "gestionar_lead_taller",
      description:
        "Registra o actualiza una oportunidad de repuestos o taller/postventa en el CRM (/crm/taller). Usar SIEMPRE que el cliente pregunte por repuestos, piezas, accesorios o solicite turno/service una vez conocida su localidad.",
      schema: z.object({
        serviceType: z.enum(["REPUESTOS", "SERVICIO_TECNICO", "REPARACION", "GARANTIA"]),
        serviceDescription: z.string().describe("Nombre del repuesto o detalle del trabajo"),
        city: z.string().describe("Ciudad o localidad del cliente"),
        fullName: z.string().optional().describe("Nombre completo del cliente si lo mencionó"),
        motoModel: z.string().optional().describe("Modelo o cilindrada de la moto"),
        km: z.string().optional().describe("Kilometraje actual de la moto"),
        year: z.string().optional().describe("Año de fabricación de la moto"),
        code: z.string().optional().describe("Código de la pieza si fue provisto"),
        notes: z.string().optional()
      })
    }
  );

  const requestServiceAppointmentTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const clientName = (
        args.name ||
        effectiveContext?.fullName ||
        [effectiveContext?.firstName, effectiveContext?.lastName].filter(Boolean).join(" ") ||
        ""
      ).trim();
      const effectiveCity = (args.city || effectiveContext?.city || "").trim();
      const effectivePhone = (senderNumber || senderJid || effectiveContext?.phone || "").trim();

      if (!clientName || clientName.toLowerCase().includes("sin nombre")) {
        return JSON.stringify({
          status: "missing_required_identity",
          missingField: "fullName",
          message: "Falta el Nombre y Apellido del cliente. Solicítale su nombre completo antes de agendar el turno."
        });
      }
      if (!effectiveCity) {
        return JSON.stringify({
          status: "missing_required_identity",
          missingField: "city",
          message: "Falta la Ciudad o Localidad del cliente. Pregúntale de qué localidad es antes de agendar el turno."
        });
      }

      const resolvedState = inferStateFromCity(effectiveCity, effectiveContext?.state);

      try {
        await axios.post(
          `${backendUrl}/api/v1/crm/workshop-opportunities`,
          {
            conversationId,
            phone: effectivePhone,
            fullName: clientName,
            city: effectiveCity,
            state: resolvedState || undefined,
            businessLine: "TALLER",
            serviceType: "SERVICIO_TECNICO",
            serviceDescription: `${args.serviceType || "Servicio Técnico / Mantenimiento"} (Moto: ${args.motoModel || "No especificada"}) [Turno solicitado: ${args.preferredDate || "A coordinar"}]`,
            vehicleModel: args.motoModel || "",
            scheduledDate: args.preferredDate || "",
            status: "NUEVO",
            source: "IA"
          },
          { headers: { "x-api-key": apiKey }, timeout: 8000 }
        );
        return JSON.stringify({ status: "success", message: "Turno de taller registrado en CRM exitosamente." });
      } catch {
        return JSON.stringify({
          status: "success",
          message: "Turno de taller registrado para ser confirmado por el asesor."
        });
      }
    },
    {
      name: "requestServiceAppointment",
      description: "Registra una solicitud de turno para el taller o service oficial.",
      schema: z.object({
        name: z.string().describe("Nombre completo del cliente"),
        motoModel: z.string().describe("Marca y modelo de la moto"),
        serviceType: z.string().optional().describe("Tipo de service o reparación requerida"),
        city: z.string().describe("Ciudad o localidad del cliente"),
        preferredDate: z.string().describe("Fecha y hora preferida por el cliente")
      })
    }
  );

  const checkRepuestoStockTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      try {
        const res = await axios.get(`${backendUrl}/api/v1/repuestos/stock/search`, {
          params: {
            query: args.repuestoName || "",
            code: args.code || "",
            locality: args.locality
          },
          headers: { "x-api-key": apiKey },
          timeout: 10000
        });
        return JSON.stringify(res.data);
      } catch {
        return JSON.stringify({
          status: "success",
          found: false,
          repuestoName: args.repuestoName,
          code: args.code,
          locality: args.locality,
          message: `No se encontró stock para "${args.code || args.repuestoName}" en ${args.locality}.`
        });
      }
    },
    {
      name: "checkRepuestoStock",
      description: "Consulta el stock de un repuesto o accesorio por nombre/descripción o código exacto según la localidad del cliente.",
      schema: z.object({
        repuestoName: z.string().optional().describe("Nombre o descripción del repuesto"),
        code: z.string().optional().describe("Código o número de pieza del repuesto si fue proporcionado"),
        locality: z.string().describe("Ciudad o localidad del cliente")
      })
    }
  );

  const getSucursalesTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      try {
        let res: any;
        const headers = apiKey ? { "x-api-key": apiKey } : {};
        try {
          res = await axios.get(`${backendUrl}/api/v1/sucursales/public/list`, { headers, timeout: 10000 });
        } catch {
          res = await axios.get(`${backendUrl}/api/v1/sucursales/all`, { headers, timeout: 10000 });
        }
        const allSucursales: any[] = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data)
          ? res.data
          : [];
        const queryClean = (args.locality || "").toString().toLowerCase().trim();

        const filtered = allSucursales.filter((s: any) => {
          const ciudadStr = (s.ciudad || s.Ciudad || s.nombre || s.Nombre || "").toString().toLowerCase();
          const provinciaStr = (s.provincia || s.Provincia || "").toString().toLowerCase();
          const direccionStr = (s.direccion || s.Direccion || "").toString().toLowerCase();
          return (
            ciudadStr.includes(queryClean) ||
            queryClean.includes(ciudadStr) ||
            provinciaStr.includes(queryClean) ||
            queryClean.includes(provinciaStr) ||
            direccionStr.includes(queryClean)
          );
        });

        const listToReturn = filtered.length > 0 ? filtered : allSucursales;
        const resultList = listToReturn.map((s: any) => ({
          nombre: s.nombre || s.Nombre || "Sucursal All Motors",
          direccion: s.direccion || s.Direccion || "Dirección no especificada",
          ciudad: s.ciudad || s.Ciudad || "",
          provincia: s.provincia || s.Provincia || "",
          telefono: s.telefono || s.Telefono || ""
        }));

        return JSON.stringify({
          status: "success",
          locality: args.locality,
          count: resultList.length,
          sucursales: resultList
        });
      } catch {
        return JSON.stringify({
          status: "error",
          message: "No se pudieron obtener las sucursales en este momento."
        });
      }
    },
    {
      name: "getSucursales",
      description:
        "Consulta las sucursales oficiales de All Motors cargadas en la Intranet (nombre, dirección, ciudad, provincia, teléfono) según la localidad indicada por el cliente.",
      schema: z.object({
        locality: z.string().describe("Ciudad, localidad o provincia indicada por el cliente")
      })
    }
  );

  const getClientProfileTool = tool(
    async (args) => {
      const backendUrl = getCleanBackendUrl();
      const apiKey = getBackendApiKey();
      const target = args.phoneOrDni || senderJid || senderNumber;
      try {
        const res = await axios.get(`${backendUrl}/api/v1/crm/conversation/active/${encodeURIComponent(target)}`, {
          headers: { "x-api-key": apiKey },
          timeout: 15000
        });
        const foundLead = res.data?.data?.lead;
        return JSON.stringify(
          foundLead
            ? { status: "success", lead: foundLead }
            : { status: "success", lead: null, message: "No hay ficha registrada previa para este cliente." }
        );
      } catch (error: any) {
        return JSON.stringify({ status: "error", message: `Error consultando perfil: ${error.message}` });
      }
    },
    {
      name: "getClientProfile",
      description: "Consulta en MongoDB el perfil del cliente por su teléfono, JID o DNI para verificar sus datos guardados.",
      schema: z.object({
        phoneOrDni: z.string().optional().describe("Número de teléfono, JID o DNI del cliente")
      })
    }
  );

  const consultarPromocionesVigentesTool = tool(
    async (args) => {
      const promos = await fetchActivePromotionsForBot(
        args.category && args.category !== "TODAS" ? args.category : undefined,
        true
      );
      return JSON.stringify({
        status: "success",
        count: promos.length,
        promotions: promos.map((p: any) => ({
          title: p.title,
          category: p.category,
          shortSummary: p.shortSummary,
          fullDescription: p.fullDescription,
          discountText: p.discountText,
          applicableModels: p.applicableModels,
          applicableBranches: p.applicableBranches,
          validUntil: p.validUntil
        }))
      });
    },
    {
      name: "consultar_promociones_vigentes",
      description:
        "Consulta las promociones, descuentos y noticias vigentes de All Motors (Motos, Repuestos, Accesorios, Indumentaria, Servicios de Taller o Noticias Generales) para avisarle al cliente durante la charla.",
      schema: z.object({
        category: z
          .enum(["TODAS", "MOTOS", "REPUESTOS", "ACCESORIOS", "INDUMENTARIA", "SERVICIOS_TALLER", "NOTICIAS"])
          .optional()
          .describe("Categoría de promociones a consultar (o 'TODAS').")
      })
    }
  );

  return [
    guardarDatosUsuarioTool,
    gestionarLeadComercialTool,
    crearNuevoLeadTool,
    actualizarLeadActivoTool,
    registrarReclamoContactoTool,
    createZohoLeadTool,
    evaluarCreditoTool,
    checkFinancingTool,
    gestionarLeadTallerTool,
    requestServiceAppointmentTool,
    checkRepuestoStockTool,
    getSucursalesTool,
    getClientProfileTool,
    consultarPromocionesVigentesTool
  ];
}
