# Bose

## Présentation

Cette intégration amène vos **enceintes et barres de son Bose récentes** dans Gladys : marche et veille, volume et sourdine, lecture, pause, précédent et suivant, ce qui est en cours de lecture, la source (TV, entrée optique, vos préréglages), les réglages du son (graves, aigus, centre, surround, hauteur…), le mode dialogue et la batterie des enceintes portables. Les groupes multiroom et les préréglages sont disponibles dans les scènes.

Elle s’adresse aux enceintes installées avec l’**application Bose** (anciennement Bose Music) : Smart Soundbar, Smart Ultra Soundbar, Soundbar 550/700/900, Smart Speaker, Home Speaker 300/500, Portable Smart Speaker, Music Amplifier. L’**ancienne gamme SoundTouch** (SoundTouch 10/20/30, Wave SoundTouch…, installée avec l’application SoundTouch) utilise un autre protocole : pour celles-là, utilisez l’intégration **Bose SoundTouch** du store.

**Fonctionnement** : les enceintes sont pilotées sur votre **réseau local** (un WebSocket sur le port 8082) et elles signalent elles-mêmes chaque changement : rien n’est interrogé en boucle. Mais Bose leur fait accepter uniquement un jeton du **compte Bose** auquel elles appartiennent : l’intégration se connecte avec votre e-mail et votre mot de passe pour l’obtenir, puis le renouvelle. Cette connexion est la seule chose qui passe par les serveurs Bose. Cette intégration n’est pas officielle et n’a aucun lien avec Bose ; le protocole a été documenté par la communauté (projet pybose) et peut changer avec une mise à jour Bose.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Des enceintes installées dans l’application Bose et connectées au **même réseau que Gladys**.
- L’e-mail et le mot de passe du compte Bose auquel les enceintes appartiennent. Un compte ouvert avec Google ou Apple n’a pas de mot de passe : définissez-en un d’abord sur la page du compte Bose.
- Un accès Internet pour Gladys, le temps de la connexion au compte Bose (puis au plus une fois par heure, pour renouveler le jeton).
- À l’installation, acceptez la **découverte réseau** (mDNS `_bose-passport._tcp`), qui permet à Gladys de trouver les enceintes.

## Configuration

### Compte Bose

Renseignez **E-mail du compte Bose** et **Mot de passe du compte Bose**, enregistrez, puis appuyez sur **Tester le compte et rechercher les enceintes** : le message liste chaque enceinte trouvée avec son modèle, son adresse et si elle répond. Le mot de passe est conservé par Gladys comme secret, jamais réaffiché ni écrit dans les journaux ; le jeton est gardé dans le dossier `/data` de l’intégration.

Si Bose refuse l’e-mail ou le mot de passe, l’intégration l’indique et ne réessaie pas tant que vous ne les avez pas modifiés (des essais répétés pourraient bloquer le compte).

### Enceintes et langue

- **Adresses IP des enceintes** : seulement pour une enceinte que la recherche automatique ne trouve pas (autre sous-réseau, réseau qui filtre le multicast), séparées par des virgules. Donnez une adresse fixe à vos enceintes dans votre box : une enceinte dont l’adresse a changé est retrouvée par son GUID, mais plus vite avec une adresse fixe.
- **Rechercher à nouveau sur le réseau** : toutes les heures (par défaut), toutes les 15 minutes, ou jamais. Une enceinte qui ne répond plus déclenche de toute façon une recherche.
- **Langue des textes** : noms des fonctionnalités, des sources et des préréglages, et messages d’erreur des scènes, car Gladys ne transmet pas votre langue avec eux.

## Utilisation

### Appareils

Ouvrez l’onglet **Découverte** de l’intégration et ajoutez vos enceintes. Une enceinte a ces fonctionnalités, selon le modèle :

- **Marche/veille**, **Volume** (0 à 100), **Muet**.
- **Lecture**, **Pause**, **Précédent**, **Suivant** et **État de la lecture** (en lecture ou en pause, aussi une commande) : la boîte Musique du tableau de bord les utilise.
- **Source** : TV, optique, entrée analogique ou AUX quand la barre de son les a, et vos préréglages (« Préréglage 2 · FIP »). **Autre** désigne une source que Gladys ne peut pas choisir elle-même (Spotify, AirPlay, Bluetooth…).
- **En cours** et **Artiste** (textes, comme avant).
- Pour la boîte Musique du tableau de bord : **Titre**, **Artiste du morceau**, **Album**, **Pochette**, **Durée**, **Position** (faites glisser la barre pour vous déplacer) et **Muet (lecteur)**. La boîte liste aussi vos **préréglages** : un appui en lance un. Il n’y a ni recherche ni file d’attente : les enceintes ne les proposent pas sur le réseau local.
- Une enceinte ajoutée avec une version plus ancienne : ouvrez l’onglet **Découverte** et appuyez sur **Mettre à jour** pour obtenir ces fonctionnalités. Rien d’autre ne change.
- **Graves**, **Aigus**, et sur les barres de son **Centre**, **Surround**, **Hauteur**, **Caisson de basses** : les valeurs brutes de l’enceinte, en général de −100 à +100 par pas de 10.
- **Mode dialogue** sur les barres de son qui l’ont.
- **Batterie** et **En charge** sur les enceintes portables.

Tout changement fait dans l’application Bose, avec la télécommande ou sur l’enceinte apparaît dans Gladys en moins d’une seconde.

### Transport

Le catalogue affiche le badge **local** : commandes et états ne quittent jamais votre réseau. Les serveurs Bose ne sont contactés que pour la connexion et le renouvellement du jeton. Chaque enceinte affiche **local** quand elle est connectée, **injoignable** quand elle ne répond pas.

### Widgets

![Le widget « Enceinte Bose » : la barre de son du salon lit So What de Miles Davis avec sa pochette, son état, sa source, son volume et son groupe, et les boutons Précédent, Pause, Suivant et Veille ; l’enceinte portable de la cuisine en pause avec sa batterie (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-bose/main/docs/assets/widgets.fr.png)

**Enceinte Bose** : une enceinte choisie dans les réglages, avec ce qu’elle joue et la pochette quand le service de musique en fournit une, son état, sa source, son volume, sa batterie et son groupe, et les boutons **Précédent**, **Lecture** / **Pause**, **Suivant** et **Veille** (**Allumer** en veille). Une pochette de plus de 300 Ko n’est pas affichée.

### Déclencheurs de scène

- **Une enceinte Bose commence la lecture** et **Une enceinte Bose arrête la lecture** (pause, arrêt, veille) : variables `device_name`, `title`, `artist`, `source`.
- **Une enceinte Bose change de source**, filtrable par la nouvelle source (TV, optique, un préréglage…) : variables `source`, `source_name` (Spotify, TV…), `previous_source`.
- **Une enceinte Bose ne répond plus** depuis plus d’une minute : variables `device_name`, `address`.

Aucun événement n’est envoyé dans les cinq secondes qui suivent une action de scène sur l’enceinte : une scène ne se relance jamais elle-même.

### Actions de scène

- **Lancer un préréglage sur une enceinte Bose** : préréglage 1 à 6 enregistré dans l’application Bose ; allume l’enceinte. Fournit `preset_name`.
- **Grouper des enceintes Bose** : les autres enceintes jouent ce que joue l’enceinte principale, en synchro ; elles sont ajoutées si elle pilote déjà un groupe. Fournit `group_size`.
- **Sortir une enceinte Bose de son groupe** : une enceinte qui suit rejoue seule ; l’enceinte principale dissout tout le groupe.

### Exemples de scènes

- Chaque jour de semaine à 7 h → **Lancer un préréglage sur une enceinte Bose** (cuisine, préréglage 1 : la radio du matin), puis régler son volume à 25.
- **Une enceinte Bose change de source** vers `tv` (salon) → baisser les lumières du salon et fermer les volets.
- Quand la dernière personne quitte la maison → **Sortir une enceinte Bose de son groupe**, puis mettre les enceintes en veille ; **Une enceinte Bose ne répond plus** → envoyer une notification.

## Dépannage

- **« Bose a refusé l’e-mail ou le mot de passe »** : vérifiez-les en vous connectant à l’application Bose ou à la page du compte Bose. Un compte ouvert avec Google ou Apple a d’abord besoin d’un mot de passe.
- **« Le service de connexion Bose ne répond pas comme prévu »** : Bose a peut-être modifié ses pages de connexion ; l’intégration réessaie quelques minutes plus tard. Si cela dure, ouvrez un ticket : cette partie est issue de rétro-ingénierie.
- **Aucune enceinte trouvée** : vérifiez qu’elle est installée dans l’application Bose (pas l’application SoundTouch), sur le même réseau que Gladys (pas un réseau invité), ou saisissez son adresse. Les enceintes SoundTouch relèvent de l’intégration Bose SoundTouch.
- **Une enceinte est trouvée mais refuse le jeton** : elle doit appartenir au même compte Bose que l’e-mail saisi.
- **« Gladys a refusé la recherche réseau »** : réinstallez l’intégration en acceptant sa découverte réseau, ou saisissez l’adresse de l’enceinte.
- **Pas de pochette dans le widget** : le service de musique n’en fournit pas, ou elle dépasse les 300 Ko acceptés par Gladys.
- Journaux : l’onglet Journaux de l’intégration ; ajoutez `DEBUG=gladys-integration-sdk` au conteneur pour le détail. Signalez un problème sur [GitHub](https://github.com/William-De71/gladys-bose/issues) avec votre version de Gladys, la version de l’intégration, le modèle de l’enceinte et les journaux (ils ne contiennent jamais votre mot de passe ni votre jeton).
