import os from 'os';

export interface LanAddress {
  iface: string;
  address: string;
  url: string;
  isPrivate: boolean;
  likelyVirtual: boolean;
  note: string;
}

export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

/** Detects this machine's IPv4 addresses locally. No external lookup service is used. */
export function getLanAddresses(port: number, interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [iface, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const linkLocal = a.address.startsWith('169.254.');
      const likelyVirtual = /vbox|virtualbox|vmware|docker|veth|vethernet|wsl|hyper-v|tailscale|zerotier|utun|br-|virbr|tun|tap/i.test(iface);
      const isPrivate = isPrivateIPv4(a.address);
      let note = 'Likely reachable from other devices on the same Wi-Fi/Ethernet.';
      if (linkLocal) note = 'Link-local address (no DHCP). Probably not usable.';
      else if (!isPrivate) note = 'Not a private LAN address. Avoid exposing the app on public networks.';
      else if (likelyVirtual) note = 'Looks like a virtual adapter (VM/VPN/Docker). Other devices usually cannot reach it.';
      out.push({ iface, address: a.address, url: `http://${a.address}:${port}`, isPrivate, likelyVirtual, note });
    }
  }
  const rank = (x: LanAddress) => (x.isPrivate ? 0 : 2) + (x.likelyVirtual ? 1 : 0) + (x.address.startsWith('169.254.') ? 4 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}
