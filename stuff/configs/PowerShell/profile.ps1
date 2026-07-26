[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor
    [Net.SecurityProtocolType]::Tls12
Import-Module -Name tiPS # Added by tiPS to get automatic tips and updates.
