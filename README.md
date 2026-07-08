# Encuesta de Autoevaluación de Riesgos · Gestión de la Obra Pública

Aplicación web para diligenciar la encuesta de autoevaluación de riesgos del
proceso de Gestión de la Obra Pública y visualizar el tablero de resultados en
tiempo real. Los datos se guardan en **Cloud Firestore** (proyecto
`encuesta-riesgos`) con autenticación anónima de Firebase.

## Estructura del proyecto

El HTML monolítico original se separó en archivos por responsabilidad:

```
index.html              Estructura de la página (marcado + enlaces a CDN/CSS/JS)
css/
  └── estilos.css       Estilos propios (animaciones, chips, scrollbar, etc.)
js/
  ├── firebase-config.js  Configuración WEB de Firebase y constantes (COLECCION, …)
  └── app.js              Lógica de la aplicación (formulario, tablero, datos)
firestore.rules         Copia versionada de las reglas de seguridad desplegadas
```

Orden de carga (definido en `index.html`): librerías por CDN → `firebase-config.js`
→ `app.js`. `app.js` reutiliza las constantes globales declaradas en
`firebase-config.js`.

## Base de datos (Firestore)

Ya está configurada y lista para usarse:

- **Base de datos:** Cloud Firestore en modo nativo (región `southamerica-west1`).
- **Colección:** `respuestas` (una respuesta por documento).
- **Autenticación:** proveedor **Anónimo** habilitado.
- **Reglas de seguridad** (`firestore.rules`, ya desplegadas):
  - lectura permitida a cualquier usuario autenticado (para el tablero);
  - creación permitida solo si el documento incluye el `uid` del propio usuario;
  - actualización y borrado bloqueados desde el cliente.

Cada documento de `respuestas` incluye, además de las respuestas del formulario:
`periodo`, `uid`, `creado` (marca de tiempo del servidor) y `creadoISO`.

> La colección contiene un documento de inicialización (`_seed: true`) que el
> tablero ignora automáticamente. Puede eliminarse desde la consola de Firebase
> una vez existan respuestas reales.

## Configuración de Firebase

La configuración **web** (pública) vive en `js/firebase-config.js`. Estas claves
están pensadas para enviarse al navegador; la seguridad real la aplican las
reglas de Firestore y la autenticación, no las claves.

> ⚠️ **Nunca** coloque la clave de administrador (service account / clave
> privada) en el código del cliente ni la suba al repositorio. El archivo
> `.gitignore` ya excluye los archivos `*firebase-adminsdk*.json` y similares.

## Ejecución local

Al usar librerías por CDN y módulos por `<script src>`, conviene servir los
archivos mediante un servidor local (no abrir `index.html` con `file://`):

```bash
# Con Python
python3 -m http.server 8080

# o con Node
npx serve .
```

Luego abra `http://localhost:8080`.

## Despliegue

Cualquier hosting de estáticos sirve (Firebase Hosting, GitHub Pages, etc.).
Para volver a desplegar las reglas de seguridad con la CLI de Firebase:

```bash
firebase deploy --only firestore:rules
```
