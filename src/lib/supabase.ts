import { createClient } from "@supabase/supabase-js";
import type { DiscordSession } from "@/types/discord";

// Configuración de Supabase
const env = (import.meta as any).env || {};
export const SUPABASE_URL =
  (env.VITE_SUPABASE_URL as string) ||
  (env.NEXT_PUBLIC_SUPABASE_URL as string) ||
  (env.SUPABASE_URL as string) ||
  "https://tryqwbidrcmdhkyllxti.supabase.co";

export const SUPABASE_ANON_KEY =
  (env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ||
  (env.VITE_SUPABASE_ANON_KEY as string) ||
  (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string) ||
  (env.SUPABASE_PUBLISHABLE_KEY as string) ||
  "sb_publishable_f-pNX3Wp-nBVXV2T7oJbHA_BGBCIdC7";

export const SUPABASE_SECRET_KEY =
  (env.VITE_SUPABASE_SECRET_KEY as string) ||
  (env.SUPABASE_SECRET_KEY as string) ||
  "";

export const SUPABASE_JWKS_URL =
  (env.VITE_SUPABASE_JWKS_URL as string) ||
  (env.SUPABASE_JWKS_URL as string) ||
  "https://tryqwbidrcmdhkyllxti.supabase.co/auth/v1/.well-known/jwks.json";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface SupabaseUserProfile {
  id?: string;
  discordId: string;
  username: string;
  globalName: string;
  avatarUrl: string;
  minecraftUsername: string;
  role: "admin" | "user";
  createdAt?: string;
  lastLogin?: string;
}

// Admin predeterminado configurado por el usuario
export const PRIMARY_ADMIN_DISCORD_ID = "1323020110155485326";

// Helper con tiempo límite para evitar bloqueos de red si la BD no está alcanzable
async function withTimeout<T>(promise: Promise<T>, ms = 1500, fallback: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    return fallback;
  }
}

/**
 * Sincroniza la cuenta de Discord obtenida en la base de datos de Supabase.
 * - Registra o actualiza el usuario en la tabla `users` mediante `discord_id`.
 * - Obtiene o asigna el rol ('admin' para 1323020110155485326, o de la BD).
 * - Registra el inicio de sesión en `login_logs`.
 */
export async function syncDiscordUser(session: DiscordSession): Promise<SupabaseUserProfile> {
  const isPrimaryAdmin = session.id === PRIMARY_ADMIN_DISCORD_ID;
  const defaultRole: "admin" | "user" = isPrimaryAdmin ? "admin" : "user";
  const defaultMcName = session.username.replace(/[^A-Za-z0-9_]/g, "_").substring(0, 16) || "Player";

  const defaultProfile: SupabaseUserProfile = {
    discordId: session.id,
    username: session.username,
    globalName: session.globalName || session.username,
    avatarUrl: session.avatarUrl,
    minecraftUsername: defaultMcName,
    role: defaultRole,
  };

  return withTimeout(
    (async () => {
      let fetchedRole: "admin" | "user" = defaultRole;
      let minecraftUsername = defaultMcName;

      try {
        // 1. Consultar si el usuario ya existe en la tabla `users` o `admins`
        const [userRes, adminRes] = await Promise.all([
          supabase
            .from("users")
            .select("role, minecraft_username")
            .eq("discord_id", session.id)
            .maybeSingle(),
          supabase
            .from("admins")
            .select("id")
            .eq("id", session.id)
            .maybeSingle(),
        ]);

        if (adminRes.data) {
          fetchedRole = "admin";
        } else if (!userRes.error && userRes.data) {
          fetchedRole = isPrimaryAdmin ? "admin" : (userRes.data.role as "admin" | "user") || "user";
          if (userRes.data.minecraft_username) {
            minecraftUsername = userRes.data.minecraft_username;
          }
        } else {
          // Usuario de Discord nuevo (nunca sincronizado antes): el nombre
          // de Minecraft que le vamos a asignar todavía no está reservado
          // a su nombre, así que hay que comprobar que nadie más lo tenga
          // ya registrado antes de dárselo — si no, dos personas distintas
          // podrían terminar compartiendo el mismo nombre (por ejemplo, el
          // de un administrador ya registrado).
          if (await isMinecraftUsernameTaken(minecraftUsername, session.id)) {
            const suffix = session.id.slice(-4);
            minecraftUsername = `${minecraftUsername.substring(0, 11)}_${suffix}`;
          }
        }

        // 2. Realizar Upsert en la tabla `users` (si existe la tabla)
        await supabase.from("users").upsert(
          {
            discord_id: session.id,
            username: session.username,
            global_name: session.globalName || session.username,
            avatar_url: session.avatarUrl,
            minecraft_username: minecraftUsername,
            role: fetchedRole,
            last_login: new Date().toISOString(),
          },
          { onConflict: "discord_id" }
        );

        // 3. Registrar el inicio de sesión en `login_logs`
        await logUserLogin(session.id, session.username);
      } catch (err) {
        console.warn("Sincronización silenciosa con Supabase omitida:", err);
      }

      return {
        discordId: session.id,
        username: session.username,
        globalName: session.globalName || session.username,
        avatarUrl: session.avatarUrl,
        minecraftUsername,
        role: fetchedRole,
      };
    })(),
    1500,
    defaultProfile
  );
}


/**
 * Comprueba si un nombre de Minecraft ya está registrado por OTRO usuario
 * del launcher (comparación case-insensitive contra `minecraft_username`
 * en la tabla `users`). Es la base del sistema de "un nombre, un dueño":
 * antes de dejar que alguien reclame localmente un nombre (cuenta offline
 * manual, o el nombre que se autoasigna al entrar con Discord), se
 * verifica aquí para que dos personas nunca terminen compartiendo el mismo
 * nombre — y así nadie pueda "ocupar" el nombre de un admin ya registrado.
 *
 * Nota: si Supabase no responde a tiempo, se asume que el nombre NO está
 * tomado (falla abierto) para no dejar a nadie sin poder jugar por un
 * problema de red — el mismo criterio que ya usa `withTimeout` en el resto
 * de este archivo.
 */
export async function isMinecraftUsernameTaken(
  username: string,
  excludeDiscordId?: string
): Promise<boolean> {
  return withTimeout(
    (async () => {
      let query = supabase
        .from("users")
        .select("discord_id")
        .ilike("minecraft_username", username);

      if (excludeDiscordId) {
        query = query.neq("discord_id", excludeDiscordId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("Error comprobando disponibilidad de nombre:", error);
        return false;
      }
      return (data?.length ?? 0) > 0;
    })(),
    1500,
    false
  );
}

/**
 * Consulta el rol del usuario desde Supabase dado su Discord ID.
 */
export async function getUserRole(discordId: string): Promise<"admin" | "user"> {
  if (discordId === PRIMARY_ADMIN_DISCORD_ID) {
    return "admin";
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("role")
      .eq("discord_id", discordId)
      .maybeSingle();

    if (!error && data?.role) {
      return data.role as "admin" | "user";
    }
  } catch (err) {
    console.warn("Error consultando rol en Supabase:", err);
  }

  return "user";
}

/**
 * Registra un evento de inicio de sesión en la tabla `login_logs`.
 */
export async function logUserLogin(discordId: string, username: string): Promise<void> {
  try {
    await supabase.from("login_logs").insert({
      discord_id: discordId,
      username,
      logged_at: new Date().toISOString(),
      client_version: "0.1.0",
    });
  } catch (err) {
    console.warn("Error al registrar log de inicio de sesión:", err);
  }
}

export interface SupabaseInstance {
  id: string;
  name: string;
  version: string;
  modloader: "vanilla" | "fabric" | "forge" | "quilt";
  modloader_version?: string;
  icon?: string;
  description?: string;
  whitelist_enabled: boolean;
  logo_path?: string;
  background_path?: string;
  content_version: number;
  created_at: string;
}

export interface SupabaseMod {
  id: string;
  instance_id: string;
  file_name: string;
  storage_path?: string;
  sha1?: string;
  size_bytes?: number;
  source: string;
  download_url?: string;
  created_at: string;
}

export interface SupabaseConfigFile {
  id: string;
  instance_id: string;
  target_path: string;
  storage_path?: string;
  sha1?: string;
  size_bytes?: number;
  source: string;
  download_url?: string;
  created_at: string;
}

/**
 * Consulta todas las instancias disponibles directamente desde Supabase.
 */
export async function getSupabaseInstances(): Promise<SupabaseInstance[]> {
  try {
    const { data, error } = await supabase
      .from("instances")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Error al obtener instancias desde Supabase:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("Fallo al conectar con Supabase:", err);
    return [];
  }
}

/**
 * Obtiene la lista de mods asociados a una instancia desde Supabase.
 */
export async function getSupabaseInstanceMods(instanceId: string): Promise<SupabaseMod[]> {
  try {
    const { data, error } = await supabase
      .from("mods")
      .select("*")
      .eq("instance_id", instanceId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Error al obtener mods desde Supabase:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("Error al consultar mods en Supabase:", err);
    return [];
  }
}

/**
 * Obtiene los archivos de configuración de una instancia desde Supabase.
 */
export async function getSupabaseInstanceConfigs(instanceId: string): Promise<SupabaseConfigFile[]> {
  try {
    const { data, error } = await supabase
      .from("config_files")
      .select("*")
      .eq("instance_id", instanceId)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Error al obtener configs desde Supabase:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("Error al consultar configs en Supabase:", err);
    return [];
  }
}

/**
 * Canjea un código de acceso mediante la función RPC de Supabase `redeem_code`.
 */
export async function redeemAccessCode(
  code: string,
  provider: "discord" | "microsoft",
  externalId: string,
  displayName?: string
): Promise<{ success: boolean; instance_id?: string; already_had_access?: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc("redeem_code", {
      p_code: code,
      p_provider: provider,
      p_external_id: externalId,
      p_display_name: displayName || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return data as any;
  } catch (err) {
    return { success: false, error: "No se pudo conectar con Supabase para canjear el código." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noticias / Notificaciones del Admin
// ─────────────────────────────────────────────────────────────────────────────

export interface SupabaseNewsItem {
  id: string;
  title: string;
  body: string | null;
  tag: string;
  emoji: string;
  image_path: string | null;
  published_at: string;
}

/**
 * Obtiene todas las noticias/notificaciones desde Supabase,
 * ordenadas por fecha de publicación (más recientes primero).
 * Estas son las noticias creadas desde el Panel de Administración.
 */
export async function getSupabaseNews(): Promise<SupabaseNewsItem[]> {
  try {
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(20);

    if (error) {
      console.warn("Error al obtener noticias desde Supabase:", error);
      return [];
    }
    return (data as SupabaseNewsItem[]) || [];
  } catch (err) {
    console.warn("Fallo al conectar con Supabase para noticias:", err);
    return [];
  }
}

/**
 * Suscribe a cambios en tiempo real de la tabla `news` de Supabase.
 * Llama a `onUpdate` cuando se inserta, actualiza o elimina una noticia
 * desde el Panel de Administración, sin necesidad de reiniciar el launcher.
 * Devuelve una función de limpieza para cancelar la suscripción.
 */
export function subscribeNewsRealtime(onUpdate: () => void): () => void {
  const channel = supabase
    .channel("news-realtime")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "news" },
      () => onUpdate()
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "news" },
      () => onUpdate()
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "news" },
      () => onUpdate()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[Supabase Realtime] news channel suscrito OK");
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
