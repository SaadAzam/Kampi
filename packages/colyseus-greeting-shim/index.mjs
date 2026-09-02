const banner = String.raw`
   ___      _
  / __\___ | |_   _ ___  ___ _   _ ___
 / /  / _ \| | | | / __|/ _ \ | | / __|
/ /__| (_) | | |_| \__ \  __/ |_| \__ \
\____/\___/|_|\__, |___/\___|\__,_|___/
              |___/

Multiplayer Framework for Node.js · Open-source
`;

export default banner;
export function greet() {
  console.log(banner);
}
