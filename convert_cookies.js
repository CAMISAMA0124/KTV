
import fs from 'fs';

function jsonToNetscape(jsonPath, netscapePath) {
    const cookies = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    let netscape = '# Netscape HTTP Cookie File\n';
    netscape += '# http://curl.haxx.se/rfc/cookie_spec.html\n';
    netscape += '# This is a generated file!  Do not edit.\n\n';

    cookies.forEach(c => {
        const domain = c.domain;
        const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const path = c.path || '/';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = Math.floor(c.expirationDate || 0);
        const name = c.name;
        const value = c.value;
        netscape += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expiry}\t${name}\t${value}\n`;
    });

    fs.writeFileSync(netscapePath, netscape);
    console.log(`Converted ${jsonPath} to ${netscapePath}`);
}

jsonToNetscape('www.youtube.com_cookies.json', 'youtube_cookies.txt');
