'use strict';
/* ============================================================================
   Configuración de Firebase (WEB · pública) · Encuesta de Riesgos
   ----------------------------------------------------------------------------
   Estas claves son PÚBLICAS por diseño: se envían al navegador. La seguridad
   real se aplica en las reglas de Firestore (ver firestore.rules) y en la
   autenticación, NO en estas claves.

   ⚠️  NUNCA coloque aquí la clave de administrador (service account / private
       key). Ese archivo es secreto y no debe subirse al repositorio.

   Este archivo se carga ANTES que js/app.js. Los valores provienen de:
   Consola de Firebase → ⚙️ Configuración del proyecto → «Tus apps» → Web → SDK.
   ============================================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyAskQlJGaVj4cyWTDEJJ7c0VjWGH9EdyQs",
  authDomain: "encuesta-riesgos.firebaseapp.com",
  projectId: "encuesta-riesgos",
  storageBucket: "encuesta-riesgos.firebasestorage.app",
  messagingSenderId: "871713644230",
  appId: "1:871713644230:web:1d77de85594908944941c7"
};

/* Nombre de la colección de Firestore donde se guardan las respuestas. */
const COLECCION = 'respuestas';

/* Periodo evaluado (se almacena junto con cada respuesta). */
const PERIODO_DEFAULT = 'Primer cuatrimestre 2025 (01/12/2024 – 31/03/2025)';

/* Clave del borrador local (localStorage) para formularios largos. */
const BORRADOR_KEY = 'borrador_encuesta_riesgos_v1';
