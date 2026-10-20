# Bose

## Presentación

Esta integración lleva a Gladys sus **altavoces y barras de sonido Bose recientes**: encendido y espera, volumen y silencio, reproducir, pausa, anterior y siguiente, lo que suena, la fuente (TV, entrada óptica, sus presintonías), los ajustes de sonido (graves, agudos, central, envolvente, altura…), el modo diálogo y la batería de los altavoces portátiles. Los grupos multisala y las presintonías están disponibles en las escenas.

Está pensada para los altavoces configurados con la **aplicación Bose** (antes Bose Music): Smart Soundbar, Smart Ultra Soundbar, Soundbar 550/700/900, Smart Speaker, Home Speaker 300/500, Portable Smart Speaker, Music Amplifier. La **antigua gama SoundTouch** (SoundTouch 10/20/30, Wave SoundTouch…, configurada con la aplicación SoundTouch) usa otro protocolo: para esos, use la integración **Bose SoundTouch** de la tienda.

**Funcionamiento**: los altavoces se controlan en su **red local** (un WebSocket en el puerto 8082) y avisan ellos mismos de cada cambio, así que no se consulta nada en bucle. Pero Bose hace que solo acepten un token de la **cuenta Bose** a la que pertenecen: la integración inicia sesión con su correo y su contraseña para obtenerlo y luego lo renueva. Ese inicio de sesión es lo único que pasa por los servidores de Bose. Esta integración no es oficial ni tiene relación con Bose; el protocolo lo documentó la comunidad (proyecto pybose) y puede cambiar con una actualización de Bose.

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Altavoces configurados en la aplicación Bose y conectados a la **misma red que Gladys**.
- El correo y la contraseña de la cuenta Bose a la que pertenecen los altavoces. Una cuenta abierta con Google o Apple no tiene contraseña: defina una primero en la página de la cuenta Bose.
- Acceso a Internet para Gladys durante el inicio de sesión en la cuenta Bose (luego como mucho una vez por hora, para renovar el token).
- En la pantalla de instalación, acepte la **detección de red** (mDNS `_bose-passport._tcp`), que permite a Gladys encontrar los altavoces.

## Configuración

### Cuenta Bose

Rellene **Correo de la cuenta Bose** y **Contraseña de la cuenta Bose**, guarde y pulse **Probar la cuenta y buscar los altavoces**: el mensaje lista cada altavoz encontrado con su modelo, su dirección y si responde. Gladys guarda la contraseña como secreto, nunca se vuelve a mostrar ni se escribe en los registros; el token se guarda en la carpeta `/data` de la integración.

Si Bose rechaza el correo o la contraseña, la integración lo indica y no vuelve a intentarlo hasta que los cambie (los intentos repetidos podrían bloquear la cuenta).

### Altavoces e idioma

- **Direcciones IP de los altavoces**: solo para un altavoz que la búsqueda automática no encuentra (otra subred, una red que filtra el multicast), separadas por comas. Dé a sus altavoces una dirección fija en el router: un altavoz cuya dirección cambió se vuelve a encontrar por su GUID, pero antes con una dirección fija.
- **Volver a buscar en la red**: cada hora (por defecto), cada 15 minutos o nunca. Un altavoz que deja de responder provoca una búsqueda de todos modos.
- **Idioma de los textos**: nombres de las funciones, de las fuentes y de las presintonías, y mensajes de error de las escenas, porque Gladys no envía su idioma con ellos.

## Uso

### Dispositivos

Abra la pestaña **Descubrir** de la integración y añada sus altavoces. Un altavoz tiene estas funciones, según el modelo:

- **Encendido**, **Volumen** (0 a 100), **Silencio**.
- **Reproducir**, **Pausa**, **Anterior**, **Siguiente** y **Estado de reproducción**: la caja Música del panel los usa.
- **Fuente**: TV, óptica, entrada analógica o AUX cuando la barra de sonido las tiene, y sus presintonías («Presintonía 2 · FIP»). **Otra** indica una fuente que Gladys no puede elegir por sí misma (Spotify, AirPlay, Bluetooth…).
- **Reproduciendo** y **Artista**.
- **Graves**, **Agudos** y, en las barras de sonido, **Central**, **Envolvente**, **Altura**, **Subwoofer**: los valores brutos del altavoz, normalmente de −100 a +100 en pasos de 10.
- **Modo diálogo** en las barras de sonido que lo tienen.
- **Batería** y **Cargando** en los altavoces portátiles.

Cualquier cambio hecho en la aplicación Bose, con el mando o en el altavoz aparece en Gladys en menos de un segundo.

### Transporte

El catálogo muestra la insignia **local**: las órdenes y los estados nunca salen de su red. Los servidores de Bose solo se contactan para iniciar sesión y renovar el token. Cada altavoz muestra **local** cuando está conectado y **inaccesible** cuando no responde.

### Widgets

![El widget «Altavoz Bose»: la barra de sonido del salón reproduce So What de Miles Davis con su carátula, estado, fuente, volumen y grupo, y los botones Anterior, Pausa, Siguiente y En espera; el altavoz portátil de la cocina en pausa con su batería (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-bose/main/docs/assets/widgets.es.png)

**Altavoz Bose**: un altavoz elegido en los ajustes, con lo que suena y su carátula cuando el servicio de música la proporciona, su estado, fuente, volumen, batería y grupo, y los botones **Anterior**, **Reproducir** / **Pausa**, **Siguiente** y **En espera** (**Encender** en espera). Una carátula de más de 300 KB no se muestra.

### Disparadores de escena

- **Un altavoz Bose empieza a reproducir** y **Un altavoz Bose deja de reproducir** (pausa, parada, espera): variables `device_name`, `title`, `artist`, `source`.
- **Un altavoz Bose cambia de fuente**, filtrable por la nueva fuente (TV, óptica, una presintonía…): variables `source`, `source_name` (Spotify, TV…), `previous_source`.
- **Un altavoz Bose deja de responder** durante más de un minuto: variables `device_name`, `address`.

No se envía ningún evento en los cinco segundos siguientes a una acción de escena sobre el altavoz: una escena nunca se lanza a sí misma.

### Acciones de escena

- **Reproducir una presintonía en un altavoz Bose**: presintonía 1 a 6 guardada en la aplicación Bose; enciende el altavoz. Devuelve `preset_name`.
- **Agrupar altavoces Bose**: los demás altavoces reproducen en sincronía lo que suena en el principal; se añaden si ya dirige un grupo. Devuelve `group_size`.
- **Sacar un altavoz Bose de su grupo**: un altavoz que sigue vuelve a sonar solo; el altavoz principal disuelve todo el grupo.

### Ejemplos de escenas

- Cada día laborable a las 7 h → **Reproducir una presintonía en un altavoz Bose** (cocina, presintonía 1: la radio de la mañana) y poner su volumen a 25.
- **Un altavoz Bose cambia de fuente** a `tv` (salón) → bajar las luces del salón y cerrar las persianas.
- Cuando la última persona sale de casa → **Sacar un altavoz Bose de su grupo** y poner los altavoces en espera; **Un altavoz Bose deja de responder** → enviar una notificación.

## Solución de problemas

- **«Bose rechazó el correo o la contraseña»**: compruébelos iniciando sesión en la aplicación Bose o en la página de la cuenta Bose. Una cuenta abierta con Google o Apple necesita primero una contraseña.
- **«El servicio de inicio de sesión de Bose no responde como se esperaba»**: puede que Bose haya cambiado sus páginas de inicio de sesión; la integración lo vuelve a intentar unos minutos después. Si persiste, abra una incidencia: esta parte procede de ingeniería inversa.
- **No se encuentra ningún altavoz**: compruebe que está configurado en la aplicación Bose (no en la aplicación SoundTouch) y en la misma red que Gladys (no una red de invitados), o escriba su dirección. Los altavoces SoundTouch necesitan la integración Bose SoundTouch.
- **Se encuentra un altavoz pero rechaza el token**: debe pertenecer a la misma cuenta Bose que el correo introducido.
- **«Gladys rechazó la búsqueda en la red»**: reinstale la integración aceptando su detección de red, o escriba la dirección del altavoz.
- **No hay carátula en el widget**: el servicio de música no la proporciona, o supera los 300 KB que acepta Gladys.
- Registros: la pestaña Registros de la integración; añada `DEBUG=gladys-integration-sdk` al contenedor para ver el detalle. Informe de un problema en [GitHub](https://github.com/William-De71/gladys-bose/issues) con su versión de Gladys, la versión de la integración, el modelo del altavoz y los registros (nunca contienen su contraseña ni su token).
