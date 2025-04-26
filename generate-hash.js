    // generate-hash.js
    // This script requires and uses bcryptjs from the project's node_modules

    // Import the library
    const bcrypt = require('bcryptjs');

    // The pin code you want to hash
    const pinToHash = '4529';

    // Salt rounds (10 is a good default)
    const saltRounds = 10;

    // Generate the hash
    const hash = bcrypt.hashSync(pinToHash, saltRounds);

    // Print the hash to the console
    console.log("Generated Hash:");
    console.log(hash);
    